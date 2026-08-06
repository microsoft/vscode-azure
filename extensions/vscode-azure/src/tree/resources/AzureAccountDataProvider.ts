/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    getAuthProviderId, getConfiguredAzureEnv,
    ICredentialFactory,
    isAccount, isTenant,
    PublicAuthProviderId, SovereignAuthProviderId, SovereignCloudConfigurationSection,
    SubscriptionClient,
    type AzureAccount, type AzureSubscription, type AzureTenant,
    type ConcreteAzureNode,
} from '@microsoft/vscode-azure-azutils';
import {
    Debouncer, EventEmitter, Everything, IActionExecutor, ICodeContext, Roots, stringifyError,
    type ChildResult, type DataProvider, type DataProviderChangeEvent, type Disposable, type Event, type Page, type ProviderResult,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable, type ServiceIdentifier } from 'inversify';
import { ConfigurationSection, SignedInTenantsConfigurationKey } from '../../constants';
import { readSignedInTenants } from '../../utils/signedInTenants';

/**
 * Identifier for the root account/tenant/subscription data provider. Bound as a
 * singleton and aliased into the resource tree's data-provider collection so the
 * "Run (Mock Data)" debug entry point can rebind it with mock data.
 */
export interface IAzureAccountDataProvider extends DataProvider<ConcreteAzureNode> {
    /** Fires with normalized account IDs removed by a reconciled session change. */
    readonly onDidRemoveAccounts: Event<readonly string[]>;
}

export const IAzureAccountDataProvider: ServiceIdentifier<IAzureAccountDataProvider> = Symbol.for('IAzureAccountDataProvider');

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
 */
@injectable()
export class AzureAccountDataProvider implements IAzureAccountDataProvider, Disposable {
    public readonly isRoot = true;

    private readonly changeEmitter = new EventEmitter<DataProviderChangeEvent<ConcreteAzureNode>>();
    private readonly removeAccountsEmitter = new EventEmitter<readonly string[]>();

    /**
     * Debounces `onDidChangeSessions` bursts into a single reconciling root
     * re-list. Keyed so it can be shared if more debounced streams are added later.
     */
    private readonly debouncer = new Debouncer();

    private readonly disposables: Disposable[] = [this.changeEmitter, this.removeAccountsEmitter, this.debouncer];

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

    public readonly onDidChange = this.changeEmitter.event;
    public readonly onDidRemoveAccounts = this.removeAccountsEmitter.event;

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(ICredentialFactory) private readonly credentialFactory: ICredentialFactory,
    ) {
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
                // listing was fetched against the old endpoint and is invalid.
                this.changeEmitter.fire({ target: Everything });
            } else if (e.affectsConfiguration(`${ConfigurationSection}.${SignedInTenantsConfigurationKey}`)) {
                this.executor.output.debug('[auth] signed-in tenants configuration changed; invalidating accounts');
                // The user edited the manually-entered tenants directly (e.g. in
                // settings.json). Those tenants are folded into each account's
                // tenant listing, so re-list to surface added tenants and drop
                // removed ones.
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
            return this.listAccounts();
        }

        if (isAccount(resource)) {
            return this.listTenantsForAccount(resource);
        }

        if (isTenant(resource)) {
            return this.listSubscriptionsForTenant(resource);
        }

        throw new Error(`Unsupported resource type: ${JSON.stringify(resource)}`);
    }

    /**
     * @inheritdoc
     *
     * Upgrades a manually-entered tenant's placeholder display name -- the raw
     * tenant id, used as a stand-in when tenant listing was blocked at sign-in
     * time (e.g. conditional access) -- to its real name, fetched with a
     * tenant-scoped token now that the user has a live session for the tenant.
     *
     * A tenant-scoped credential is required: the account-scoped `tenants.list()`
     * is exactly the call conditional access blocked (why the tenant had to be
     * entered manually), so it would fail again here. A token scoped to the
     * tenant satisfies the policy and lets the listing return that tenant's name.
     *
     * Only placeholder tenants are enriched: accounts, and tenants that were
     * listed normally (and so already carry a real display name), are skipped
     * without any network call. Acquisition is silent, so this background pass
     * never surfaces an interactive sign-in prompt; if no cached session
     * satisfies it, or the listing is still blocked, the placeholder is left
     * untouched.
     *
     * @returns Always `false`: a tenant's subscriptions do not depend on its
     *   display name, so only the tenant's own tree item is re-rendered.
     */
    public async enrich(resource: ConcreteAzureNode): Promise<boolean> {
        // enrich runs for every node this provider handles (accounts and
        // tenants). Cheaply bail unless this is a manually-entered tenant whose
        // display name is still the placeholder (equal to the tenant id).
        if (!isTenant(resource)) {
            return false;
        }

        const wantedTenantId = resource.tenantId.toLowerCase();
        if (resource.displayName.toLowerCase() !== wantedTenantId) {
            return false;
        }

        try {
            // Scope the credential to this tenant (mirroring listSubscriptionsForTenant)
            // and silence it so background enrichment never prompts. Each tenant
            // needs its own token, so there is no sharing between tenants.
            const credential = this.credentialFactory({
                tenantId: resource.tenantId,
                sessionOptions: { account: { id: resource.accountId, label: '' }, silent: true },
            });
            const client = SubscriptionClient.create(this.ctx, this.executor, credential, resource.environment);
            for await (const page of client.tenants.list()) {
                const match = page.items.find(tenant => tenant.tenantId?.toLowerCase() === wantedTenantId);
                // Skip a match that still only carries the id (no real name yet).
                if (match?.displayName && match.displayName.toLowerCase() !== wantedTenantId) {
                    Object.assign(resource, { displayName: match.displayName });
                    return false;
                }
            }
        } catch (error) {
            // Silent acquisition failed (no cached session) or listing is still
            // blocked; keep the tenant-id placeholder rather than surfacing an error.
            this.executor.output.debug(`[auth] tenant name enrich skipped for tenant=${resource.tenantId}: ${stringifyError(error)}`);
        }

        return false;
    }

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
        this.knownAccountIds = new Set(result.map(account => account.id.toLowerCase()));

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
            const currentIds = new Set(accounts.map(account => account.id.toLowerCase()));

            if (previousIds !== undefined && idSetsEqual(previousIds, currentIds)) {
                this.executor.output.trace(`[auth] sessions changed provider=${providerId}; account set unchanged (count=${currentIds.size}), ignoring`);
                return;
            }

            // The set of accounts changed, so trigger a reconciling root re-list
            // (includeChildren: false). Tenant / subscription subtrees under accounts
            // that survive the change are preserved by the tree's root reconciliation;
            // a signed-out account's subtree is evicted because it drops out of the
            // new listing.
            this.executor.output.debug(`[auth] sessions changed provider=${providerId}; account set changed (count=${currentIds.size}), re-listing accounts`);
            if (previousIds) {
                const removedIds = [...previousIds].filter(id => !currentIds.has(id));
                if (removedIds.length > 0) {
                    this.removeAccountsEmitter.fire(removedIds);
                }
            }
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
     * Tenants the user signed in to by manually entering a tenant id (persisted
     * via {@linkcode readSignedInTenants}) are merged into the listing so the
     * tree can reach them even when listing tenants is blocked outright (e.g.
     * conditional access). They are appended to the final page (or, if the
     * listing itself fails, become the only page), and deduplicated against the
     * listed tenants so a tenant that is both listed and saved keeps its real
     * display name rather than the bare id stand-in.
     *
     * @param account - The account whose tenants are listed.
     */
    private async *listTenantsForAccount(account: AzureAccount): AsyncIterable<Page<ConcreteAzureNode>> {
        const manualTenants = this.manualTenantsForAccount(account);
        const seen = new Set<string>();
        let emittedTerminalPage = false;

        const credential = this.credentialFactory({ sessionOptions: { account } });
        const client = SubscriptionClient.create(this.ctx, this.executor, credential, account.environment);
        try {
            for await (const page of client.tenants.list()) {
                const items = page.items
                    .filter((tenant): tenant is typeof tenant & { tenantId: string; displayName: string } => !!tenant.tenantId && !!tenant.displayName)
                    .map(tenant => ({
                        ...tenant,
                        tenantId: tenant.tenantId.toLowerCase(),
                        environment: account.environment,
                        accountId: account.id,
                    } satisfies AzureTenant));
                items.forEach(tenant => seen.add(tenant.tenantId));

                if (page.hasMore) {
                    yield { items, hasMore: true };
                } else {
                    // Final page: fold in any manual tenants not already listed.
                    const extras = manualTenants.filter(tenant => !seen.has(tenant.tenantId));
                    yield { items: [...items, ...extras], hasMore: false };
                    emittedTerminalPage = true;
                }
            }
        } catch (error) {
            // Listing tenants can fail outright (e.g. conditional access). Fall
            // back to the manually-entered tenants below rather than surfacing an
            // error: a tenant-scoped sign-in still works, so those tenants are
            // reachable even though they can't be enumerated.
            this.executor.output.warn(this.ctx.code.l10n.t('[auth] listing tenants failed; falling back to {0} manually-entered tenant(s): {1}', manualTenants.length, stringifyError(error)));
        }

        if (!emittedTerminalPage) {
            // The listing failed, or yielded nothing, so emit the manual tenants
            // as the terminal page (deduped against anything already streamed).
            const extras = manualTenants.filter(tenant => !seen.has(tenant.tenantId));
            yield { items: extras, hasMore: false };
        }
    }

    /**
     * Build synthesized {@linkcode AzureTenant}s for the manually-entered
     * tenants saved for the given account. No display name is available (listing
     * is what's blocked), so the tenant id is used as the label stand-in.
     *
     * The persisted setting is user-editable, so it can contain duplicate tenant
     * ids (differing only in casing); they are deduplicated here so a tenant is
     * never surfaced more than once for the same account.
     */
    private manualTenantsForAccount(account: AzureAccount): AzureTenant[] {
        const seen = new Set<string>();
        const tenants: AzureTenant[] = [];
        const accountId = account.id.toLowerCase();
        for (const entry of readSignedInTenants(this.ctx.code)) {
            // Match account ids case-insensitively (matching the `byAccount`
            // selector): the persisted id is written verbatim from
            // `session.account.id` and this setting is user-editable, so a casing
            // difference must not prevent a saved tenant from being folded into
            // its account's listing.
            if (entry.accountId.toLowerCase() !== accountId) {
                continue;
            }
            const tenantId = entry.tenantId.toLowerCase();
            if (seen.has(tenantId)) {
                continue;
            }
            seen.add(tenantId);
            tenants.push({
                tenantId,
                displayName: entry.tenantId,
                environment: account.environment,
                accountId: account.id,
            } satisfies AzureTenant);
        }
        return tenants;
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
