/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    IAzureListingCache,
    ICredentialFactory,
    isAccount, isTenant,
    PublicAuthProviderId, SovereignAuthProviderId, SovereignCloudConfigurationSection,
    SubscriptionClient,
    type AzureAccount, type AzureListingCache,
    type ConcreteAzureNode,
} from '@microsoft/vscode-azure-azutils';
import {
    CaselessSet, DebounceScheduler, Disposable, EventEmitter, Everything, filterPages, IActionExecutor, ICodeContext, IDebounceScheduler, Roots, stringifyError,
    type ChildResult, type DataProvider, type DataProviderChangeEvent, type Event, type ICaselessSetReader, type ProviderResult,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable, unmanaged, type ServiceIdentifier } from 'inversify';
import { ConfigurationSection, SelectedSubscriptionsConfigurationKey, SignedInTenantsConfigurationKey } from '../../constants';
import { createSubscriptionFilter } from '../../utils/subscriptionFilter';

/**
 * Identifier for the root account/tenant/subscription data provider. Bound as a
 * singleton and aliased into the resource tree's data-provider collection.
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

/** Debounce key for coalescing `onDidChangeSessions` bursts. */
const SessionInvalidationKey = Symbol('AzureAccountDataProvider.sessionInvalidation');

/**
 * Window (ms) during which a session-change event is treated as this provider's
 * own echo of the `getAccounts()` call it just made.
 */
const SelfInducedSessionEventMs = 1000;

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
 * Root data-layer provider for the account / tenant / subscription levels of the
 * Azure resources tree.
 *
 * Reads the hierarchy from the {@linkcode AzureListingCache}, passing the
 * `vscode-azure.selectedSubscriptions` filter on every read. **The data tree is
 * always filtered**: an excluded tenant is skipped during the walk, so no
 * tenant-scoped token is minted for it, its subscriptions are never listed, and
 * nothing below it can be drilled. That guarantee has to live here rather than
 * in the view layer, because by the time the view sees a tenant the requests
 * have already been made -- and minting a token can surface an interactive
 * conditional-access prompt for a tenant the user deselected precisely to stop
 * being prompted.
 *
 * The cache underneath stays unfiltered, so flows that *edit* the filter can
 * still enumerate everything, and the parts this provider skipped are the only
 * parts they have to fetch.
 *
 * Children never expire on their own ({@linkcode getTtl} returns `Infinity`);
 * the provider instead fires {@linkcode onDidChange} when the user signs in or
 * out, changes the configured sovereign cloud, edits the manually-entered
 * tenants, or changes the filter.
 */
@injectable()
export class AzureAccountDataProvider implements IAzureAccountDataProvider, Disposable {
    public readonly isRoot = true;

    private readonly changeEmitter = new EventEmitter<DataProviderChangeEvent<ConcreteAzureNode>>();
    private readonly removeAccountsEmitter = new EventEmitter<readonly string[]>();

    private readonly disposables: Disposable[];

    /**
     * The account ids seen by the most recent listing, or `undefined` if
     * accounts have never been listed. Used to decide whether an
     * `onDidChangeSessions` burst actually added or removed an account -- the
     * only change worth acting on. The vast majority of session events (token
     * refreshes, other extensions' activity, re-auth of the same account) leave
     * this set unchanged.
     */
    private knownAccountIds: ICaselessSetReader | undefined;

    /**
     * The one session-change echo expected from the current `getAccounts()`.
     * Only one event is consumed; further events in the window are reconciled.
     */
    private expectedSessionChangeEcho: { readonly providerId: string; until: number } | undefined;

    public readonly onDidChange = this.changeEmitter.event;
    public readonly onDidRemoveAccounts = this.removeAccountsEmitter.event;

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(ICredentialFactory) private readonly credentialFactory: ICredentialFactory,
        @inject(IAzureListingCache) private readonly listings: AzureListingCache,
        @unmanaged() private readonly sessionChangeScheduler: IDebounceScheduler = new DebounceScheduler(SessionChangeDebounceMs, SessionInvalidationKey),
    ) {
        this.disposables = [this.changeEmitter, this.removeAccountsEmitter, this.sessionChangeScheduler];
        this.disposables.push(this.ctx.code.authentication.onDidChangeSessions(e => {
            if (e.provider.id !== PublicAuthProviderId && e.provider.id !== SovereignAuthProviderId) {
                return;
            }

            const expectedEcho = this.expectedSessionChangeEcho;
            if (expectedEcho?.providerId === e.provider.id) {
                this.expectedSessionChangeEcho = undefined;
                if (this.sessionChangeScheduler.now() < expectedEcho.until) {
                    this.executor.output.trace(`[auth] sessions changed provider=${e.provider.id}; suppressed expected self-induced echo`);
                    return;
                }
            }

            const providerId = e.provider.id;
            this.sessionChangeScheduler.debounce(() => this.reconcileAccountsOnSessionChange(providerId));
        }));

        this.disposables.push(this.ctx.code.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(SovereignCloudConfigurationSection)) {
                // Only the accounts listing was taken against the ambient cloud;
                // every key beneath it carries its own environment, so the two
                // clouds' listings coexist rather than collide. Re-enumerating
                // accounts is a local call, and switching back is free.
                this.executor.output.debug('[auth] sovereign cloud configuration changed; re-enumerating accounts');
                this.listings.reenumerateAccounts();
                this.changeEmitter.fire({ target: Everything });
            } else if (e.affectsConfiguration(`${ConfigurationSection}.${SignedInTenantsConfigurationKey}`)) {
                // Deliberately no cache invalidation: manually-entered tenants
                // are merged above the cache, on every read. An added tenant
                // appears immediately (its subscriptions are simply a miss when
                // something drills into it) and a removed one stops appearing
                // while its subscriptions stay cached in case it returns.
                this.executor.output.debug('[auth] signed-in tenants configuration changed; re-merging over cached listings');
                this.changeEmitter.fire({ target: Everything });
            } else if (e.affectsConfiguration(`${ConfigurationSection}.${SelectedSubscriptionsConfigurationKey}`)) {
                // Deliberately no cache invalidation: a filter change alters
                // which cached nodes are admitted, not whether any of them are
                // true. The tree re-walks, and everything it asks for that was
                // fetched before is served without a single request.
                //
                // Fired directly, never through the session debouncer: this is
                // an explicit user action, and unselecting then immediately
                // re-selecting is ordinary. Collapsing the two would leave the
                // tree showing the first selection.
                this.executor.output.debug('[auth] subscription filter changed; re-applying filter to cached listings');
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
            //
            // The id set is recorded because session reconciliation compares
            // against it to decide whether an `onDidChangeSessions` burst
            // actually changed anything.
            return this.listings.listAccounts().then(accounts => {
                this.knownAccountIds = new CaselessSet(accounts.map(account => account.id));
                return accounts;
            });
        }

        const filter = createSubscriptionFilter(this.ctx.code);

        if (isAccount(resource)) {
            // Excluded tenants are skipped by the cache itself, so no
            // tenant-scoped token is minted for them and their subscriptions are
            // never listed.
            return this.listings.listTenants(resource, filter?.admitsTenant);
        }

        if (isTenant(resource)) {
            // By contrast this tenant is already listed, so dropping a
            // subscription here saves no work -- it is only about what the tree
            // shows, and belongs above the cache.
            return filterPages(this.listings.listSubscriptions(resource), filter?.admitsSubscription);
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
     * Enrichment only ever runs for tenants this provider handed out, so a
     * tenant the filter excluded is never enriched -- which matters, because
     * minting that tenant-scoped token is itself the prompt the filter exists to
     * avoid. Acquisition is additionally silent, so this background pass never
     * prompts for the tenants it does enrich; if no cached session satisfies it,
     * or the listing is still blocked, the placeholder is left untouched.
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

    /** @inheritdoc */
    public dispose(): void {
        Disposable.disposeAll(this.disposables);
    }

    /**
     * Reconcile the signed-in account set in response to a (debounced)
     * `onDidChangeSessions` burst, firing a reconciling root re-list **only if
     * the set of accounts actually changed**.
     *
     * The question "did the account set change?" cannot be asked of the cached
     * listing -- it would replay the memo and always answer "no" -- so this
     * discards *only* the accounts listing and seeds the fresh result back in.
     * The re-list this triggers is therefore served from cache, and the tenants
     * and subscriptions already fetched under accounts that are still signed in
     * stay cached: a new account signing in does not make another account's
     * tenants untrue.
     *
     * An account that signed out is left cached: it has dropped out of the
     * accounts listing, so nothing beneath it is reachable any more, and
     * discarding it would only make the next sign-in slower.
     *
     * @param providerId - The auth provider id that triggered the burst (logging only).
     */
    private async reconcileAccountsOnSessionChange(providerId: string): Promise<void> {
        try {
            const previousIds = this.knownAccountIds;

            // The event this provokes can arrive while `getAccounts()` is still
            // outstanding or just after it settles. Consume at most one event;
            // any additional event is a real change that must be reconciled.
            const expectedEcho = {
                providerId,
                until: this.sessionChangeScheduler.now() + SelfInducedSessionEventMs,
            };
            this.expectedSessionChangeEcho = expectedEcho;
            let accounts: AzureAccount[];
            try {
                // Discard first: asking the memo would replay it and always
                // answer "no change". The fresh result is seeded back, so the
                // re-list this triggers is served from cache.
                this.listings.reenumerateAccounts();
                accounts = await this.listings.listAccounts();
            } finally {
                if (this.expectedSessionChangeEcho === expectedEcho) {
                    expectedEcho.until = this.sessionChangeScheduler.now() + SelfInducedSessionEventMs;
                }
            }

            const currentIds = new CaselessSet(accounts.map(account => account.id));
            this.knownAccountIds = currentIds;

            if (previousIds !== undefined && idSetsEqual(previousIds, currentIds)) {
                this.executor.output.trace(`[auth] sessions changed provider=${providerId}; account set unchanged (count=${currentIds.size}), ignoring`);
                return;
            }

            this.executor.output.debug(`[auth] sessions changed provider=${providerId}; account set changed (count=${currentIds.size}), re-listing accounts`);
            if (previousIds) {
                const removedIds = [...previousIds].filter(id => !currentIds.has(id));
                if (removedIds.length > 0) {
                    // Nothing is evicted for a signed-out account. Its listings
                    // are already unreachable -- the account is gone from the
                    // accounts listing, and a node is only reachable by
                    // descending the listing that produced it -- so keeping them
                    // costs memory only, and makes the re-sign-in that usually
                    // follows a token expiry instant.
                    this.removeAccountsEmitter.fire(removedIds);
                }
            }

            // A reconciling root re-list (includeChildren: false). Subtrees under
            // accounts that survive the change are preserved by the tree's root
            // reconciliation; a signed-out account's subtree is evicted because
            // it drops out of the new listing.
            this.changeEmitter.fire({ target: Roots });
        } catch (error) {
            // This runs as a fire-and-forget reconcile, and listing accounts can
            // throw (a transient `getAccounts()` failure, or a misconfigured
            // custom cloud). Swallow and log rather than surfacing an unhandled
            // rejection; a later session event or the tree's own root fetch will
            // retry.
            this.executor.output.warn(`[auth] sessions changed provider=${providerId}; account reconcile failed: ${stringifyError(error)}`);
        }
    }
}
