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
    Debouncer, EventEmitter, IActionExecutor, ICodeContext,
    type ChildResult, type DataProvider, type DataProviderChangeEvent, type Disposable, type Page, type ProviderResult,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable, type ServiceIdentifier } from 'inversify';

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

    public readonly onDidChange = this.changeEmitter.event;

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
                this.invalidateAll();
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
        const previousIds = this.knownAccountIds;
        const accounts = await this.listAccounts();
        const currentIds = new Set(accounts.map(account => account.id));

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
        this.changeEmitter.fire({ resource: undefined, includeChildren: false });
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

    private invalidateAll(): void {
        this.changeEmitter.fire({ resource: undefined, includeChildren: true });
    }

    /** @inheritdoc */
    public dispose(): void {
        this.disposables.forEach(d => void d.dispose());
    }
}
