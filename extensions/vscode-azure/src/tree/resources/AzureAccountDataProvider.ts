/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AzureListingCache,
    ICredentialFactory,
    isAccount, isTenant,
    PublicAuthProviderId, SovereignAuthProviderId, SovereignCloudConfigurationSection,
    SubscriptionClient,
    type ConcreteAzureNode,
} from '@microsoft/vscode-azure-azutils';
import {
    CaselessSet, DebounceScheduler, Disposable, EventEmitter, Everything, IActionExecutor, ICodeContext, IDebounceScheduler, Roots, stringifyError,
    type ChildResult, type DataProvider, type DataProviderChangeEvent, type Event, type ICaselessSetReader, type Page, type ProviderResult,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable, unmanaged, type ServiceIdentifier } from 'inversify';
import { IAzureListingCache } from '../../services';
import { ConfigurationSection, SelectedSubscriptionsConfigurationKey, SignedInTenantsConfigurationKey } from '../../constants';
import { readSubscriptionFilter } from '../../utils/subscriptionFilter';
import { AzureAccountListingSource, IAzureAccountListingSource } from './AzureAccountListingSource';

/**
 * Identifier for the root account/tenant/subscription data provider. Bound as a
 * singleton and aliased into the resource tree's data-provider collection so the
 * "Run (Mock Data)" debug entry point can rebind it with mock data.
 *
 * {@linkcode DataProvider.getChildren} is *filtered*: a tenant excluded by
 * `vscode-azure.selectedSubscriptions` is never listed, and therefore never has
 * a tenant-scoped token minted for it. That guarantee is the whole point of
 * filtering in the data layer, so there is no opt-out on the tree itself. Flows
 * that must see past the filter depend on the unfiltered `IAzureListingSource`
 * instead, which is served by the same {@linkcode AzureListingCache} this
 * provider reads.
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
 * Debounce key for coalescing `onDidChangeSessions` bursts.
 */
const SessionInvalidationKey = Symbol('AzureAccountDataProvider.sessionInvalidation');

/** Whether two sets contain exactly the same ids, ignoring case. */
function idSetsEqual(a: ICaselessSetReader, b: ICaselessSetReader): boolean {
    if (a.size !== b.size) {
        return false;
    }

    for (const id of a) {
        if (!b.has(id)) {
            return false;
        }
    }

    return true;
}

/**
 * Drop tenants excluded by the filter, preserving page boundaries and `hasMore`.
 *
 * A page may become empty while `hasMore` is still `true`; that is intentional
 * and correct, because dropping the page would misreport whether more pages
 * remain.
 *
 * @param tenantIds - Ids of the tenants to admit (matched case-insensitively).
 */
async function* filterTenantPages(
    pages: AsyncIterable<Page<ConcreteAzureNode>>,
    tenantIds: ICaselessSetReader,
): AsyncIterable<Page<ConcreteAzureNode>> {
    for await (const page of pages) {
        yield { items: page.items.filter(node => isTenant(node) && tenantIds.has(node.tenantId)), hasMore: page.hasMore };
    }
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
 * (`authentication.onDidChangeSessions`), changes the configured sovereign
 * cloud (`microsoft-sovereign-cloud`), or edits the subscription filter.
 *
 * The tenant half of the `vscode-azure.selectedSubscriptions` filter is applied
 * here, in the data layer, rather than by the view. Filtering tenants above this
 * point would still list an excluded tenant's subscriptions -- minting a
 * tenant-scoped token, and potentially prompting for interactive sign-in -- only
 * to discard the result. The subscription half stays in the view, where it costs
 * nothing: a tenant's subscriptions all arrive in one listing.
 * The unfiltered `IAzureListingSource` is the deliberate exception, for flows
 * that let the user edit the filter.
 */
@injectable()
export class AzureAccountDataProvider implements IAzureAccountDataProvider, Disposable {
    public readonly isRoot = true;

    private readonly changeEmitter = new EventEmitter<DataProviderChangeEvent<ConcreteAzureNode>>();
    private readonly removeAccountsEmitter = new EventEmitter<readonly string[]>();

    private readonly disposables: Disposable[];

    public readonly onDidChange = this.changeEmitter.event;
    public readonly onDidRemoveAccounts = this.removeAccountsEmitter.event;

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(ICredentialFactory) private readonly credentialFactory: ICredentialFactory,
        @inject(IAzureListingCache) private readonly listings: AzureListingCache,
        @inject(IAzureAccountListingSource) private readonly source: AzureAccountListingSource,
        @unmanaged() private readonly sessionChangeScheduler: IDebounceScheduler = new DebounceScheduler(SessionChangeDebounceMs, SessionInvalidationKey),
    ) {
        this.disposables = [this.changeEmitter, this.removeAccountsEmitter, this.sessionChangeScheduler];
        this.disposables.push(this.ctx.code.authentication.onDidChangeSessions(e => {
            if (e.provider.id !== PublicAuthProviderId && e.provider.id !== SovereignAuthProviderId) {
                return;
            }

            // Listing accounts can itself trigger a session-change event;
            // ignore events while a getAccounts() call is in flight (any
            // duration) or inside the trailing window, to avoid looping.
            if (this.source.isSuppressingSessionEvents()) {
                this.executor.output.trace(`[auth] sessions changed provider=${e.provider.id}; suppressed (self-induced window)`);
                return;
            }

            // Debounce bursts of session changes, then reconcile the account
            // set. The reconcile itself decides whether anything actually
            // changed (see reconcileAccountsOnSessionChange).
            const providerId = e.provider.id;
            this.sessionChangeScheduler.debounce(() => this.reconcileAccountsOnSessionChange(providerId));
        }));

        this.disposables.push(this.ctx.code.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(SovereignCloudConfigurationSection)) {
                this.executor.output.debug('[auth] sovereign cloud configuration changed; invalidating accounts');
                // The configured environment itself changed, so every cached
                // listing was fetched against the old endpoint and is untrue.
                this.listings.clear();
                this.changeEmitter.fire({ target: Everything });
            } else if (e.affectsConfiguration(`${ConfigurationSection}.${SignedInTenantsConfigurationKey}`)) {
                this.executor.output.debug('[auth] signed-in tenants configuration changed; invalidating accounts');
                // The user edited the manually-entered tenants directly (e.g. in
                // settings.json). Those tenants are folded into each account's
                // tenant listing, so the cached listings no longer match the
                // setting and must be re-fetched.
                this.listings.clear();
                this.changeEmitter.fire({ target: Everything });
            } else if (e.affectsConfiguration(`${ConfigurationSection}.${SelectedSubscriptionsConfigurationKey}`)) {
                this.executor.output.debug('[auth] subscription filter changed; re-listing from cache');
                // Re-list so newly-admitted tenants appear (they were filtered
                // out of the previous listing, so the tree has never seen them).
                //
                // Deliberately does NOT clear the listing cache: the filter
                // changing does not make any cached listing untrue. Widening the
                // filter therefore costs nothing when the tenant was already
                // fetched -- typically the case, since Select Subscriptions just
                // enumerated everything to build its pick list.
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
     *
     * Applies the tenant half of the `vscode-azure.selectedSubscriptions` filter.
     * A tenant excluded here is never listed, so
     * {@linkcode listSubscriptionsForTenant} is never called for it and no
     * tenant-scoped token is ever requested -- the only place the filter can
     * actually avoid a request.
     *
     * Subscriptions are deliberately *not* filtered here. A tenant's
     * subscriptions arrive in one listing, so dropping some of them saves no
     * request; that half of the filter is presentation, and stays in the view.
     *
     * Accounts are never filtered: the filter keys carry no account id, and an
     * account whose tenants are all excluded simply lists no children.
     *
     * @throws if `resource` is neither an account nor a tenant.
     */
    public getChildren(resource?: ConcreteAzureNode): ProviderResult<ChildResult<ConcreteAzureNode>> {
        if (!resource) {
            // Lists already-signed-in accounts without prompting. The user is
            // prompted to sign in lazily when an operation actually needs a
            // credential (the default credential uses `createIfNone`).
            return this.listings.listAccounts();
        }

        if (isAccount(resource)) {
            const tenants = this.listings.listTenantsForAccount(resource);
            const filter = readSubscriptionFilter(this.ctx.code);
            return filter ? filterTenantPages(tenants, filter.tenantIds) : tenants;
        }

        if (isTenant(resource)) {
            return this.listings.listSubscriptionsForTenant(resource);
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
            const client = SubscriptionClient.create(this.ctx, this.executor, credential, resource.environment, undefined, resource);
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
     * burst purely to detect whether the set changed. That call also arms the
     * self-induced-event suppression window
     * ({@linkcode AzureAccountListingSource.isSuppressingSessionEvents}), which
     * -- together with this set comparison -- defends against feedback loops
     * should `getAccounts()` itself ever start emitting `onDidChangeSessions`
     * again (a bug we have seen in the past): re-entrant events are suppressed
     * while the call is in flight, and any that still slip through reconcile to
     * an unchanged set and stop here without re-firing.
     *
     * @param providerId - The auth provider id that triggered the burst (logging only).
     */
    private async reconcileAccountsOnSessionChange(providerId: string): Promise<void> {
        try {
            const previousIds = this.source.knownAccountIds;
            // Refreshes rather than reading the cached list: the whole point is
            // to detect that the signed-in account set changed, which a memoized
            // list could never reveal. The fresh result reseeds the cache, so the
            // root re-list below is served without a second fetch.
            const accounts = await this.listings.refreshAccounts();
            const currentIds = new CaselessSet(accounts.map(account => account.id));

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
                // Evict the subtrees of accounts that went away. Accounts that
                // survived keep their tenant/subscription listings -- those are
                // still true, and re-fetching them is exactly the cost this cache
                // exists to avoid.
                const removedIds = [...previousIds].filter(id => !currentIds.has(id));
                for (const id of removedIds) {
                    this.listings.clearAccount(id);
                }
                if (removedIds.length > 0) {
                    this.removeAccountsEmitter.fire(removedIds);
                }
            }
            this.changeEmitter.fire({ target: Roots });
        } catch (error) {
            // This runs as a fire-and-forget reconcile, and listing accounts can
            // throw (a transient getAccounts() failure, or getConfiguredAzureEnv()
            // throwing on a misconfigured custom cloud). Swallow and log rather
            // than surfacing an unhandled rejection; a later session event or the
            // tree's own root fetch will retry.
            this.executor.output.warn(`[auth] sessions changed provider=${providerId}; account reconcile failed: ${stringifyError(error)}`);
        }
    }

    /** @inheritdoc */
    public dispose(): void {
        Disposable.disposeAll(this.disposables);
    }
}