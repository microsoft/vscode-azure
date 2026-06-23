/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    buildAccountCacheData,
    environmentFingerprintsMatch, fingerprintEnvironment,
    getAuthProviderId, getConfiguredAzureEnv,
    hydrateAccountCache,
    ICredentialFactory,
    isAccount, isTenant,
    PublicAuthProviderId, SovereignAuthProviderId, SovereignCloudConfigurationSection,
    SubscriptionClient,
    tenantCacheKey,
    toSerializedAccount, toSerializedSubscription, toSerializedTenant,
    type AzureAccount, type AzureSubscription, type AzureTenant,
    type ConcreteAzureNode, type EnvironmentLike,
} from '@microsoft/vscode-azure-azutils';
import {
    Debouncer, EventEmitter, Everything, IActionExecutor, ICodeContext, Roots, stringifyError, subtreeOf,
    type ChildResult, type DataProvider, type DataProviderChangeEvent, type Disposable, type Page, type ProviderResult,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable, type ServiceIdentifier } from 'inversify';
import { IAccountCacheStore } from './AccountCacheStore';

/**
 * Identifier for the root account/tenant/subscription data provider. Bound as a
 * singleton and aliased into the resource tree's data-provider collection so the
 * "Run (Mock Data)" debug entry point can rebind it with mock data.
 */
export const IAzureAccountDataProvider: ServiceIdentifier<DataProvider<ConcreteAzureNode>> = Symbol.for('IAzureAccountDataProvider');

/**
 * Debounce window (ms) for `authentication.onDidChangeSessions`. These events
 * fire frequently and often for reasons we don't care about, so bursts are
 * coalesced into a single reconciling root re-list.
 */
const SessionChangeDebounceMs = 500;

/**
 * Suppression window (ms) applied around our own `getAccounts()` call. Listing
 * accounts can itself trigger an `onDidChangeSessions` event; ignoring events
 * for a short window around the call breaks that self-induced feedback loop.
 */
const GetAccountsSuppressionMs = 1000;

/** Debounce key for coalescing `onDidChangeSessions` bursts. */
const SessionInvalidationKey = Symbol('AzureAccountDataProvider.sessionInvalidation');

/** Cache-bucket key for the root account listing. */
const AccountsBucketKey = 'accounts';

/** Cache-bucket key for the tenants under a given account. */
function tenantsBucketKey(accountId: string): string {
    return `tenants:${accountId}`;
}

/** Cache-bucket key for the subscriptions under a given tenant. */
function subscriptionsBucketKey(accountId: string, tenantId: string): string {
    return `subscriptions:${tenantCacheKey(accountId, tenantId)}`;
}

/** Whether two node lists serialize identically (used to skip no-op refreshes). */
function listEqual<T>(a: readonly T[], b: readonly T[], toSerialized: (value: T) => unknown): boolean {
    if (a.length !== b.length) {
        return false;
    }
    return JSON.stringify(a.map(toSerialized)) === JSON.stringify(b.map(toSerialized));
}

/** Whether two sets contain exactly the same string ids. */
function idSetsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
    return a.size === b.size && a.isSubsetOf(b);
}

/**
 * Root data-layer provider for the account / tenant / subscription levels of the
 * Azure resources tree.
 *
 * Talks directly to the VS Code `authentication` API and
 * `@azure/arm-resources-subscriptions` (via {@linkcode SubscriptionClient}),
 * producing account roots, tenant children for each account, and subscription
 * children for each tenant. Resource groups and below are handled by other
 * providers.
 *
 * Credentials are obtained from an {@linkcode ICredentialFactory}; the data layer
 * never stores credentials on subscriptions.
 *
 * Children never expire on their own ({@linkcode getTtl} returns `Infinity`);
 * the provider instead fires {@linkcode onDidChange} when the user signs in/out
 * (`authentication.onDidChangeSessions`) or changes the configured sovereign
 * cloud (`microsoft-sovereign-cloud`). Subscription filtering is applied by the
 * view layer, not here.
 *
 * **Persistence (stale-while-revalidate).** Each level is also mirrored to a
 * filesystem snapshot via {@linkcode IAccountCacheStore}. On a cold start the
 * provider hydrates from that snapshot and serves it immediately, then refreshes
 * the level from the network in the background; if the refreshed data differs it
 * fires a narrowly-scoped {@linkcode onDidChange} so the data layer re-pulls the
 * fresh result. The just-refreshed result is stashed in {@linkcode freshResults}
 * (consumed once on the triggered re-pull) so a refresh never re-triggers itself.
 * The first-ever fetch of a level (no snapshot) streams live, persisting each
 * page as it arrives, preserving the original lazy paging behavior.
 */
@injectable()
export class AzureAccountDataProvider implements DataProvider<ConcreteAzureNode>, Disposable {
    public readonly isRoot = true;

    private readonly changeEmitter = new EventEmitter<DataProviderChangeEvent<ConcreteAzureNode>>();

    /**
     * Debounces `onDidChangeSessions` bursts into a single reconciling root
     * re-list. Keyed so it can be shared if more debounced streams are added later.
     */
    private readonly debouncer = new Debouncer();

    private readonly disposables: Disposable[] = [this.changeEmitter, this.debouncer];

    /**
     * Count of in-flight {@linkcode listAccounts} calls. While greater than
     * zero, incoming `onDidChangeSessions` events are treated as potentially
     * self-induced and suppressed, regardless of how long the underlying
     * `getAccounts()` call takes. A counter (rather than a boolean) tolerates
     * overlapping calls. See {@linkcode suppressSessionEventsUntil} for the
     * trailing window that covers events arriving just after the call resolves.
     */
    private getAccountsInFlight = 0;

    /**
     * Timestamp (epoch ms) before which incoming `onDidChangeSessions` events
     * are ignored. Armed after our own `getAccounts()` call resolves to suppress
     * self-induced events that arrive shortly afterward. See
     * {@linkcode GetAccountsSuppressionMs}.
     */
    private suppressSessionEventsUntil = 0;

    /**
     * The set of account ids ({@linkcode AzureAccount.id}) seen by the most
     * recent {@linkcode listAccounts} call, or `undefined` if accounts have
     * never been listed. Used by {@linkcode reconcileAccountsOnSessionChange} to
     * decide whether an `onDidChangeSessions` burst actually added or removed an
     * account -- the only changes we act on. The vast majority of session events
     * (token refreshes, other extensions' activity, re-auth of the same account)
     * leave this set unchanged and are ignored.
     */
    private knownAccountIds: ReadonlySet<string> | undefined;

    /**
     * Resolves once the initial hydration from the persisted snapshot has been
     * attempted. Every {@linkcode getChildren} awaits this so a cold start serves
     * cached data rather than racing the disk read.
     */
    private readonly hydration: Promise<void>;

    /** Last-known accounts (from disk or a prior live fetch), or `undefined` if never loaded. */
    private liveAccounts: AzureAccount[] | undefined;

    /** Last-known tenants keyed by {@linkcode AzureAccount.id}. */
    private readonly liveTenantsByAccount = new Map<string, AzureTenant[]>();

    /** Last-known subscriptions keyed by {@linkcode tenantCacheKey}. */
    private readonly liveSubscriptionsByTenant = new Map<string, AzureSubscription[]>();

    /**
     * Per-bucket results stashed by a background refresh that detected a change.
     * Consumed exactly once by the {@linkcode onDidChange}-triggered re-pull so a
     * refresh cannot loop into another refresh.
     */
    private readonly freshResults = new Map<string, ConcreteAzureNode[]>();

    /** Buckets with an in-flight background refresh (dedupes concurrent refreshes). */
    private readonly refreshing = new Set<string>();

    /**
     * The environment the live state was captured against, used to fingerprint
     * the persisted snapshot. `undefined` until the first listing.
     */
    private lastEnvironment: EnvironmentLike | undefined;

    public readonly onDidChange = this.changeEmitter.event;

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(ICredentialFactory) private readonly credentialFactory: ICredentialFactory,
        @inject(IAccountCacheStore) private readonly store: IAccountCacheStore,
    ) {
        this.hydration = this.hydrate();

        this.disposables.push(this.ctx.code.authentication.onDidChangeSessions(e => {
            if (e.provider.id !== PublicAuthProviderId && e.provider.id !== SovereignAuthProviderId) {
                return;
            }

            // Listing accounts can itself trigger a session-change event;
            // ignore events while a getAccounts() call is in flight (any
            // duration) or inside the trailing window, to avoid looping.
            if (this.getAccountsInFlight > 0 || Date.now() < this.suppressSessionEventsUntil) {
                this.executor.output.trace(`[auth] sessions changed provider=${e.provider.id}; suppressed (self-induced window)`);
                return;
            }

            // Debounce bursts of session changes, then reconcile the account
            // set. The reconcile itself decides whether anything actually
            // changed (see reconcileAccountsOnSessionChange).
            const providerId = e.provider.id;
            this.debouncer.debounce(SessionInvalidationKey, SessionChangeDebounceMs, () => {
                void this.reconcileAccountsOnSessionChange(providerId);
            });
        }));

        this.disposables.push(this.ctx.code.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(SovereignCloudConfigurationSection)) {
                this.executor.output.debug('[auth] sovereign cloud configuration changed; invalidating accounts');
                // The configured environment itself changed, so every cached
                // listing (in memory and on disk) was fetched against the old
                // endpoint and is invalid.
                this.resetCache();
                this.changeEmitter.fire({ target: Everything });
            }
        }));
    }

    /** @inheritdoc */
    public getTtl(): number {
        return Infinity;
    }

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is ConcreteAzureNode {
        if (!resource || typeof resource !== 'object') {
            return false;
        }

        const node = resource as ConcreteAzureNode;
        return isAccount(node) || isTenant(node);
    }

    /**
     * @inheritdoc
     * @throws if `resource` is neither an account nor a tenant.
     */
    public getChildren(resource?: ConcreteAzureNode): ProviderResult<ChildResult<ConcreteAzureNode>> {
        if (!resource) {
            // Lists already-signed-in accounts without prompting. The user is
            // prompted to sign in lazily when an operation actually needs a
            // credential (the default credential uses `createIfNone`).
            return this.getAccounts();
        }

        if (isAccount(resource)) {
            return this.getTenants(resource);
        }

        if (isTenant(resource)) {
            return this.getSubscriptions(resource);
        }

        throw new Error(`Unsupported resource type: ${JSON.stringify(resource)}`);
    }

    // #region Level accessors (stale-while-revalidate)

    /**
     * Get the account roots: a freshly-refreshed result if one is pending,
     * otherwise the cached set (kicking off a background refresh), otherwise a
     * first-ever live listing.
     */
    private async getAccounts(): Promise<AzureAccount[]> {
        await this.hydration;

        const fresh = this.takeFresh(AccountsBucketKey);
        if (fresh) {
            return fresh as AzureAccount[];
        }

        if (this.liveAccounts) {
            const cached = this.liveAccounts;
            void this.refreshAccounts(cached);
            return cached;
        }

        const accounts = await this.listAccounts();
        this.liveAccounts = accounts;
        this.pruneToAccounts(accounts);
        void this.persist();
        return accounts;
    }

    /**
     * Get the tenants for an account: a pending refreshed result, otherwise the
     * cached set (with a background refresh), otherwise a first-ever live stream.
     */
    private async getTenants(account: AzureAccount): Promise<ChildResult<ConcreteAzureNode>> {
        await this.hydration;

        const key = tenantsBucketKey(account.id);
        const fresh = this.takeFresh(key);
        if (fresh) {
            return fresh;
        }

        const cached = this.liveTenantsByAccount.get(account.id);
        if (cached) {
            void this.refreshTenants(account, cached);
            return cached;
        }

        return this.streamAndCacheTenants(account);
    }

    /**
     * Get the subscriptions for a tenant: a pending refreshed result, otherwise
     * the cached set (with a background refresh), otherwise a first-ever live
     * stream.
     */
    private async getSubscriptions(tenant: AzureTenant): Promise<ChildResult<ConcreteAzureNode>> {
        await this.hydration;

        const key = subscriptionsBucketKey(tenant.accountId, tenant.tenantId);
        const fresh = this.takeFresh(key);
        if (fresh) {
            return fresh;
        }

        const cached = this.liveSubscriptionsByTenant.get(tenantCacheKey(tenant.accountId, tenant.tenantId));
        if (cached) {
            void this.refreshSubscriptions(tenant, cached);
            return cached;
        }

        return this.streamAndCacheSubscriptions(tenant);
    }

    /** Consume (and clear) a stashed refreshed result for `key`, if any. */
    private takeFresh(key: string): ConcreteAzureNode[] | undefined {
        const value = this.freshResults.get(key);
        if (value) {
            this.freshResults.delete(key);
        }
        return value;
    }

    // #endregion

    // #region Background refreshes

    /**
     * Re-list accounts in the background and, if the set changed, stash the
     * result and fire a reconciling root re-list so the data layer re-pulls it.
     */
    private async refreshAccounts(served: AzureAccount[]): Promise<void> {
        if (this.refreshing.has(AccountsBucketKey)) {
            return;
        }
        this.refreshing.add(AccountsBucketKey);
        try {
            const accounts = await this.listAccounts();
            this.liveAccounts = accounts;
            this.pruneToAccounts(accounts);
            if (!listEqual(served, accounts, toSerializedAccount)) {
                this.freshResults.set(AccountsBucketKey, accounts);
                void this.persist();
                this.changeEmitter.fire({ target: Roots });
            }
        } catch (error) {
            this.executor.output.warn(`[accountCache] account refresh failed: ${stringifyError(error)}`);
        } finally {
            this.refreshing.delete(AccountsBucketKey);
        }
    }

    /** Re-list an account's tenants in the background; on change, stash and re-fire. */
    private async refreshTenants(account: AzureAccount, served: AzureTenant[]): Promise<void> {
        const key = tenantsBucketKey(account.id);
        if (this.refreshing.has(key)) {
            return;
        }
        this.refreshing.add(key);
        try {
            const tenants = await this.drainItems<AzureTenant>(this.listTenantsForAccount(account));
            this.liveTenantsByAccount.set(account.id, tenants);
            if (!listEqual(served, tenants, toSerializedTenant)) {
                this.freshResults.set(key, tenants);
                void this.persist();
                this.changeEmitter.fire({ target: subtreeOf(account) });
            }
        } catch (error) {
            this.executor.output.warn(`[accountCache] tenant refresh failed: ${stringifyError(error)}`);
        } finally {
            this.refreshing.delete(key);
        }
    }

    /** Re-list a tenant's subscriptions in the background; on change, stash and re-fire. */
    private async refreshSubscriptions(tenant: AzureTenant, served: AzureSubscription[]): Promise<void> {
        const key = subscriptionsBucketKey(tenant.accountId, tenant.tenantId);
        if (this.refreshing.has(key)) {
            return;
        }
        this.refreshing.add(key);
        try {
            const subscriptions = await this.drainItems<AzureSubscription>(this.listSubscriptionsForTenant(tenant));
            this.liveSubscriptionsByTenant.set(tenantCacheKey(tenant.accountId, tenant.tenantId), subscriptions);
            if (!listEqual(served, subscriptions, toSerializedSubscription)) {
                this.freshResults.set(key, subscriptions);
                void this.persist();
                this.changeEmitter.fire({ target: subtreeOf(tenant) });
            }
        } catch (error) {
            this.executor.output.warn(`[accountCache] subscription refresh failed: ${stringifyError(error)}`);
        } finally {
            this.refreshing.delete(key);
        }
    }

    /** Buffer every page's items from a live listing into a single array. */
    private async drainItems<T>(pages: AsyncIterable<Page<ConcreteAzureNode>>): Promise<T[]> {
        const items: T[] = [];
        for await (const page of pages) {
            items.push(...(page.items as unknown as T[]));
        }
        return items;
    }

    // #endregion

    // #region First-ever streaming (no snapshot yet)

    /**
     * Stream an account's tenants live, caching and persisting each page as it
     * arrives so the lazy paging behavior is preserved on the first-ever fetch.
     */
    private async *streamAndCacheTenants(account: AzureAccount): AsyncIterable<Page<ConcreteAzureNode>> {
        const collected: AzureTenant[] = [];
        for await (const page of this.listTenantsForAccount(account)) {
            collected.push(...(page.items as unknown as AzureTenant[]));
            this.liveTenantsByAccount.set(account.id, [...collected]);
            void this.persist();
            yield page;
        }
    }

    /**
     * Stream a tenant's subscriptions live, caching and persisting each page as
     * it arrives so the lazy paging behavior is preserved on the first-ever fetch.
     */
    private async *streamAndCacheSubscriptions(tenant: AzureTenant): AsyncIterable<Page<ConcreteAzureNode>> {
        const collected: AzureSubscription[] = [];
        for await (const page of this.listSubscriptionsForTenant(tenant)) {
            collected.push(...(page.items as unknown as AzureSubscription[]));
            this.liveSubscriptionsByTenant.set(tenantCacheKey(tenant.accountId, tenant.tenantId), [...collected]);
            void this.persist();
            yield page;
        }
    }

    // #endregion

    // #region Persistence

    /** Attempt to hydrate the in-memory state from the persisted snapshot. Never throws. */
    private async hydrate(): Promise<void> {
        const data = await this.store.load();
        if (!data) {
            return;
        }

        let environment: EnvironmentLike;
        try {
            environment = getConfiguredAzureEnv(this.ctx.code);
        } catch (error) {
            this.executor.output.debug(`[accountCache] could not resolve environment for hydration: ${stringifyError(error)}`);
            return;
        }

        if (!environmentFingerprintsMatch(data.environment, fingerprintEnvironment(environment))) {
            this.executor.output.debug('[accountCache] persisted cache was captured against a different cloud; discarding');
            void this.store.clear();
            return;
        }

        const hydrated = hydrateAccountCache(data, environment);
        this.lastEnvironment = environment;
        this.liveAccounts = hydrated.accounts;
        for (const [accountId, tenants] of hydrated.tenantsByAccountId) {
            this.liveTenantsByAccount.set(accountId, tenants);
        }
        for (const [key, subscriptions] of hydrated.subscriptionsByTenantKey) {
            this.liveSubscriptionsByTenant.set(key, subscriptions);
        }
        this.executor.output.trace(`[accountCache] hydrated from persisted cache (accounts=${hydrated.accounts.length})`);
    }

    /** Rebuild and persist the whole snapshot from the current in-memory state. */
    private async persist(): Promise<void> {
        if (!this.liveAccounts || !this.lastEnvironment) {
            return;
        }
        const data = buildAccountCacheData(this.lastEnvironment, this.liveAccounts, this.liveTenantsByAccount, this.liveSubscriptionsByTenant);
        await this.store.save(data);
    }

    /** Drop all in-memory and on-disk cached state (e.g. when the cloud changes). */
    private resetCache(): void {
        this.liveAccounts = undefined;
        this.liveTenantsByAccount.clear();
        this.liveSubscriptionsByTenant.clear();
        this.freshResults.clear();
        this.refreshing.clear();
        this.lastEnvironment = undefined;
        void this.store.clear();
    }

    /**
     * Evict cached tenants/subscriptions for accounts that are no longer present,
     * so a signed-out account's subtree does not linger in the snapshot.
     */
    private pruneToAccounts(accounts: readonly AzureAccount[]): void {
        const validIds = new Set(accounts.map(account => account.id));
        for (const accountId of [...this.liveTenantsByAccount.keys()]) {
            if (!validIds.has(accountId)) {
                for (const tenant of this.liveTenantsByAccount.get(accountId) ?? []) {
                    this.liveSubscriptionsByTenant.delete(tenantCacheKey(accountId, tenant.tenantId));
                }
                this.liveTenantsByAccount.delete(accountId);
            }
        }
    }

    // #endregion

    /**
     * List the Azure accounts the user is signed in to for the currently
     * configured environment.
     *
     * Reads the configured environment via {@linkcode getConfiguredAzureEnv} and
     * attaches it to each account.
     *
     * @returns The signed-in accounts, sorted by label.
     */
    private async listAccounts(): Promise<AzureAccount[]> {
        const environment = getConfiguredAzureEnv(this.ctx.code);
        this.lastEnvironment = environment;

        // Suppress session-change events around our own getAccounts() call: the
        // call can itself trigger onDidChangeSessions, which would otherwise
        // re-enter and loop. The in-flight counter covers the call no matter how
        // long it takes; the trailing timestamp (armed in finally, so a thrown
        // call still leaves a guarded tail) covers any event that arrives just
        // after the call resolves.
        this.getAccountsInFlight++;
        let accounts;
        try {
            accounts = await this.ctx.code.authentication.getAccounts(getAuthProviderId(environment));
        } finally {
            this.suppressSessionEventsUntil = Date.now() + GetAccountsSuppressionMs;
            this.getAccountsInFlight--;
        }

        const result = accounts
            .map(account => ({
                ...account,
                environment,
            } satisfies AzureAccount))
            .sort((a, b) => a.label.localeCompare(b.label));

        // Track the current account-id set so session-change events can be
        // reconciled against it (see reconcileAccountsOnSessionChange).
        this.knownAccountIds = new Set(result.map(account => account.id));

        return result;
    }

    /**
     * Reconcile the signed-in account set in response to a (debounced)
     * `onDidChangeSessions` burst, firing a reconciling root re-list **only if
     * the set of accounts actually changed**.
     *
     * `onDidChangeSessions` fires frequently and usually for reasons that don't
     * change which accounts are signed in (token refreshes, other extensions'
     * session activity, re-auth of the same account). We only care about a
     * sign-in (new account id) or sign-out (removed account id); tenant /
     * subscription membership under an existing account changes too rarely to
     * justify discarding the (expensive to rebuild) cached subtrees, so those are
     * intentionally left in place until a full invalidation.
     *
     * Listing accounts is a cheap local operation, so it is safe to do on every
     * burst purely to detect whether the set changed. The {@linkcode listAccounts}
     * call here also arms the self-induced-event suppression window
     * ({@linkcode getAccountsInFlight} / {@linkcode suppressSessionEventsUntil}),
     * which -- together with this set comparison -- defends against feedback
     * loops should `getAccounts()` itself ever start emitting
     * `onDidChangeSessions` again (a bug we have seen in the past): re-entrant
     * events are suppressed while the call is in flight, and any that still slip
     * through reconcile to an unchanged set and stop here without re-firing.
     *
     * @param providerId - The auth provider id that triggered the burst (logging only).
     */
    private async reconcileAccountsOnSessionChange(providerId: string): Promise<void> {
        try {
            const previousIds = this.knownAccountIds;
            const accounts = await this.listAccounts();
            const currentIds = new Set(accounts.map(account => account.id));

            if (previousIds !== undefined && idSetsEqual(previousIds, currentIds)) {
                this.executor.output.trace(`[auth] sessions changed provider=${providerId}; account set unchanged (count=${currentIds.size}), ignoring`);
                return;
            }

            // The set of accounts changed, so trigger a reconciling root re-list
            // (target Roots). Refresh the cached accounts here (we already have
            // the fresh listing) and stash them so the triggered re-pull serves
            // them without kicking off a redundant refresh. Tenant / subscription
            // subtrees under accounts that survive the change are preserved by the
            // tree's root reconciliation; a signed-out account's subtree is evicted
            // (here from the snapshot via pruneToAccounts, and from the tree because
            // it drops out of the new listing).
            this.executor.output.debug(`[auth] sessions changed provider=${providerId}; account set changed (count=${currentIds.size}), re-listing accounts`);
            this.liveAccounts = accounts;
            this.pruneToAccounts(accounts);
            this.freshResults.set(AccountsBucketKey, accounts);
            void this.persist();
            this.changeEmitter.fire({ target: Roots });
        } catch (error) {
            // This runs as a fire-and-forget reconcile, and listAccounts() can
            // throw (a transient getAccounts() failure, or getConfiguredAzureEnv()
            // throwing on a misconfigured custom cloud). Swallow and log rather
            // than surfacing an unhandled rejection; a later session event or the
            // tree's own root fetch will retry.
            this.executor.output.warn(`[auth] sessions changed provider=${providerId}; account reconcile failed: ${stringifyError(error)}`);
        }
    }

    /**
     * List the tenants belonging to the given account, yielded one page at a
     * time. Accounts can belong to a very large number of tenants, so pages are
     * streamed lazily rather than buffered; ordering follows the service
     * response (no cross-page sort).
     *
     * @param account - The account whose tenants are listed.
     */
    private async *listTenantsForAccount(account: AzureAccount): AsyncIterable<Page<ConcreteAzureNode>> {
        const credential = this.credentialFactory({ sessionOptions: { account } });
        const client = SubscriptionClient.create(this.ctx, this.executor, credential, account.environment);
        for await (const page of client.tenants.list()) {
            const items = page.items
                .filter((tenant): tenant is typeof tenant & { tenantId: string; displayName: string } => !!tenant.tenantId && !!tenant.displayName)
                .map(tenant => ({
                    ...tenant,
                    tenantId: tenant.tenantId.toLowerCase(),
                    environment: account.environment,
                    accountId: account.id,
                } satisfies AzureTenant));
            yield { items, hasMore: page.hasMore };
        }
    }

    /**
     * List the subscriptions belonging to the given tenant, yielded one page at
     * a time. A tenant can contain a very large number of subscriptions, so
     * pages are streamed lazily rather than buffered; ordering follows the
     * service response (no cross-page sort).
     *
     * @param tenant - The tenant whose subscriptions are listed.
     */
    private async *listSubscriptionsForTenant(tenant: AzureTenant): AsyncIterable<Page<ConcreteAzureNode>> {
        const credential = this.credentialFactory({ tenantId: tenant.tenantId, sessionOptions: { account: { id: tenant.accountId, label: '' } } });
        const client = SubscriptionClient.create(this.ctx, this.executor, credential, tenant.environment);
        for await (const page of client.subscriptions.list()) {
            const items = page.items
                .filter((sub): sub is typeof sub & { subscriptionId: string; tenantId: string; displayName: string } => !!sub.subscriptionId && !!sub.tenantId && !!sub.displayName)
                .map(sub => ({
                    ...sub,
                    subscriptionId: sub.subscriptionId.toLowerCase(),
                    tenantId: sub.tenantId.toLowerCase(),
                    environment: tenant.environment,
                    accountId: tenant.accountId,
                } satisfies AzureSubscription));
            yield { items, hasMore: page.hasMore };
        }
    }

    /** @inheritdoc */
    public dispose(): void {
        this.disposables.forEach(d => void d.dispose());
    }
}
