/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CaselessSet, filterPages, stringifyError, type IActionExecutor, type Page } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import type { AzureAccount, AzureSubscription, AzureTenant } from '../AzureSubscription';
import type { IAzureListingFetcher } from './AzureListingFetcher';
import { AzureListingRootKey, azureListingKey, azureListingKeyFor, AzureListingStore } from './AzureListingStore';

/**
 * Decides whether a tenant takes part in a listing walk.
 *
 * Returning `false` skips the tenant **and everything beneath it**, before any
 * work is done for it: no tenant-scoped token is minted and no subscription
 * listing is issued. That is why this is a traversal-time predicate rather than
 * a post-hoc `list().filter(...)` -- by the time a listing exists its cost has
 * been paid, and for a tenant that cost is the slow part whether or not it
 * succeeds.
 *
 * The tenant is the only level worth skipping. Accounts are already in hand, and
 * omitting a subscription saves nothing once its tenant has been listed, so
 * choosing which subscriptions to *show* is left to the consumer.
 */
export type AzureTenantFilter = (tenant: AzureTenant) => boolean;

/** Options accepted by {@linkcode AzureListingCache} reads that descend into tenants. */
export interface AzureListingOptions {
    /**
     * Skip predicate applied during the walk. Omit it to read the unfiltered
     * truth -- which is what a flow that *edits* the filter must do, or the
     * filter could only ever be narrowed.
     */
    readonly filter?: AzureTenantFilter;
}

/** A subscription together with the account and tenant it was reached through. */
export interface AzureSubscriptionPath {
    readonly account: AzureAccount;
    readonly tenant: AzureTenant;
    readonly subscription: AzureSubscription;
}

/** Options for {@linkcode AzureListingCache}. */
export interface AzureListingCacheOptions {
    /**
     * Tenant ids to fold into an account's tenant listing on top of whatever
     * `tenants.list()` returns.
     *
     * Conditional access can block tenant enumeration outright, in which case
     * the only way to reach a tenant is for the user to name it. Where those ids
     * are persisted is a product concern, so this is a callback rather than
     * configuration read here.
     *
     * It is consulted **on every read, above the cache**, never folded into a
     * cached listing. That is what makes the named set free to change: adding an
     * id makes the tenant appear on the next read with nothing re-listed (its
     * subscriptions are simply a cache miss when something drills into it), and
     * removing one makes it stop appearing while its subscriptions stay cached
     * in case it comes back.
     *
     * Named tenants carry the tenant id as their display name until something
     * upgrades it, and are deduplicated against the listed tenants so a tenant
     * that is both listed and named keeps its real name.
     */
    readonly additionalTenantIds?: (account: AzureAccount) => readonly string[];
}

/**
 * An account or tenant whose listing failed during a walk -- typically a tenant
 * that cannot mint a token without interactive sign-in (conditional access /
 * additional MFA).
 */
export interface AzureListingFailure {
    readonly account: AzureAccount;
    /** The tenant that failed, or `undefined` when the account's tenant listing itself failed. */
    readonly tenant?: AzureTenant;
    readonly error: unknown;
}

/** Options for {@linkcode AzureListingCache.walkSubscriptions}. */
export interface AzureWalkOptions extends AzureListingOptions {
    /** Restrict the walk to one account. */
    readonly accountId?: string;
    /** Restrict the walk to one tenant. */
    readonly tenantId?: string;
    /**
     * Called for each account or tenant whose listing failed. A failure is
     * always isolated -- the walk continues -- so this is the only way to learn
     * about one.
     */
    readonly onFailure?: (failure: AzureListingFailure) => void;
}

/**
 * Reads the account -> tenant -> subscription hierarchy, fetching what is not
 * already cached and caching everything it fetches.
 *
 * **The cache holds unfiltered truth; the filter is applied on read, above the
 * cache.** However data was obtained -- a filtered tree walk, an unfiltered pick
 * list, a subscription lookup -- all of it is stored, including the parts the
 * caller's filter excluded. Two consequences follow, and both are the point: a
 * filtered read followed by an unfiltered one fetches only the delta (caching is
 * per **parent listing**, not per query), and changing which subset a product
 * shows needs no invalidation at all.
 *
 * Invalidation is correspondingly narrow, because a listing is expensive to earn
 * and rarely becomes wrong. Almost every change makes some data *unreachable*
 * rather than untrue, and the right response to that is to stop showing it, not
 * to discard it -- an account signing out, a tenant dropping off the named list,
 * and a filter being narrowed all fall in that class and invalidate **nothing**.
 * What remains is one narrow verb,
 * {@linkcode AzureListingCache.reenumerateTenants reenumerateTenants} /
 * {@linkcode AzureListingCache.reenumerateSubscriptions reenumerateSubscriptions} /
 * {@linkcode AzureListingCache.reenumerateAccounts reenumerateAccounts} for
 * "this child set may have grown", and {@linkcode AzureListingCache.clear clear}
 * for the rare case where the user asked for fresh data outright.
 */
export class AzureListingCache {
    private readonly store = new AzureListingStore();

    public constructor(
        private readonly fetcher: IAzureListingFetcher,
        private readonly executor: IActionExecutor,
        private readonly options?: AzureListingCacheOptions,
    ) { }

    /**
     * The accounts signed in for the configured environment.
     *
     * Cached: concurrent callers share one fetch, and later callers replay it. A
     * failed fetch is not retained, so the next call retries.
     */
    public async listAccounts(): Promise<AzureAccount[]> {
        const accounts: AzureAccount[] = [];
        for await (const page of this.accountListing().read()) {
            accounts.push(...page.items);
        }
        return accounts;
    }

    /**
     * Re-list the accounts, bypassing the cached listing and **reseeding** it
     * with the result.
     *
     * This is how "did the signed-in account set change?" is answered: asking
     * {@linkcode AzureListingCache.listAccounts listAccounts} would replay the
     * memo and always answer "no". Because the fresh result is seeded back, the
     * re-list that follows a detected change is served from cache rather than
     * fetching a second time.
     *
     * Only the accounts listing is discarded -- a new account signing in does
     * not make another account's tenants untrue.
     */
    public async refreshAccounts(): Promise<AzureAccount[]> {
        this.reenumerateAccounts();
        return this.listAccounts();
    }

    /**
     * Discard the accounts listing so the next read asks again, keeping every
     * tenant and subscription listing beneath it.
     *
     * Cheap: listing accounts is a local `getAccounts()` call with no network
     * behind it. It is also the whole response to a cloud switch, since every
     * key below the root carries its environment and so the previous cloud's
     * listings neither collide with the new cloud's nor need discarding.
     */
    public reenumerateAccounts(): void {
        this.store.evictListing(AzureListingRootKey);
    }

    /**
     * Discard one account's tenant listing so the next read asks again, keeping
     * every subscription listing beneath it.
     *
     * For "this account may be able to see a tenant it could not before" -- the
     * set may have grown, not that what was listed was wrong. Tenants that come
     * back unchanged re-attach to their cached subscriptions, so only a genuinely
     * new tenant costs anything.
     *
     * A no-op when the account is not cached, which is the honest answer: no
     * cached account means no cached tenant listing to re-ask for.
     */
    public reenumerateTenants(accountId: string): void {
        const account = this.cachedAccount(accountId);
        if (account) {
            this.store.evictListing(azureListingKey(account));
        }
    }

    /**
     * Discard one tenant's subscription listing so the next read asks again.
     *
     * For "signing in to this tenant may have authorized subscriptions that were
     * invisible when it was last listed". Nothing else is touched: the tenant
     * itself is still true, and so is every other tenant's listing.
     *
     * A no-op when the account is not cached (see
     * {@linkcode AzureListingCache.reenumerateTenants reenumerateTenants}).
     */
    public reenumerateSubscriptions(accountId: string, tenantId: string): void {
        const account = this.cachedAccount(accountId);
        if (account) {
            this.store.evictListing(azureListingKeyFor(account.environment, accountId, tenantId));
        }
    }

    /**
     * An account's tenants, one page at a time, pulling only as far as the
     * reader asks.
     *
     * Excluded tenants are dropped from their page rather than the page being
     * dropped, so the reader's paging is unaffected by how many a page loses.
     */
    public listTenants(account: AzureAccount, options?: AzureListingOptions): AsyncIterable<Page<AzureTenant>> {
        return filterPages(this.tenantPages(account), options?.filter);
    }

    /**
     * A tenant's subscriptions, one page at a time, pulling only as far as the
     * reader asks.
     *
     * Unfiltered: reaching this call means the tenant was already admitted, and
     * the expensive part -- the token and the listing itself -- is already
     * committed. Which of them to *show* is the consumer's business.
     */
    public listSubscriptions(tenant: AzureTenant): AsyncIterable<Page<AzureSubscription>> {
        return this.subscriptionListing(tenant).read();
    }

    /**
     * Walk account -> tenant -> subscription, yielding each subscription with
     * the account and tenant it was reached through.
     *
     * This is the one traversal. A filtered consumer (a tree, a lookup) and an
     * unfiltered one (a flow that edits the filter) differ only by the predicate
     * they pass; there is no second code path and no second shape of data.
     *
     * Failures are isolated: a tenant that cannot be listed is reported through
     * {@linkcode AzureWalkOptions.onFailure onFailure} and the walk continues,
     * so one unreachable tenant cannot cost the caller every other
     * subscription.
     */
    public async *walkSubscriptions(options?: AzureWalkOptions): AsyncIterable<AzureSubscriptionPath> {
        for (const account of await this.listAccounts()) {
            if (!visitsAccount(account, options)) {
                continue;
            }

            try {
                for await (const tenantPage of this.tenantPages(account)) {
                    for (const tenant of tenantPage.items) {
                        if (!visitsTenant(tenant, options)) {
                            continue;
                        }

                        try {
                            for await (const subscriptionPage of this.subscriptionListing(tenant).read()) {
                                for (const subscription of subscriptionPage.items) {
                                    yield { account, tenant, subscription };
                                }
                            }
                        } catch (error) {
                            options?.onFailure?.({ account, tenant, error });
                        }
                    }
                }
            } catch (error) {
                options?.onFailure?.({ account, error });
            }
        }
    }

    /**
     * Resolve a bare subscription id to a fully-populated
     * {@linkcode AzureSubscription}.
     *
     * Reads the cache rather than any tree, so resolution does not depend on
     * what a view has loaded, how far a listing has been paged, or whether a
     * refresh is in flight.
     *
     * Runs in two phases. The first descends only through listings already in
     * hand and is synchronous, so it provably issues no request -- which is the
     * point, since this runs in the background for tenants the user never
     * opened, and even a token request that *fails* costs tens of milliseconds.
     * Only on a miss does the second phase walk for real.
     *
     * Both phases descend through the same levels, so the filter governs this
     * lookup exactly as it governs the tree: a subscription in a tenant the user
     * deselected cannot be reached, because there is no way to arrive at it
     * except through that tenant. The caller gets `undefined` and degrades; it
     * is never an error and never a prompt.
     *
     * A subscription id alone can legitimately match more than one node (the
     * same subscription reached through two tenants); the first match in walk
     * order wins.
     *
     * @param subscriptionId - The subscription id to resolve.
     * @param options - Optional account/tenant narrowing, the filter, and a
     *   failure sink. Narrowing avoids listing tenants that cannot hold the
     *   answer.
     */
    public async findSubscription(subscriptionId: string, options?: AzureWalkOptions): Promise<AzureSubscription | undefined> {
        const wanted = subscriptionId.toLowerCase();

        for (const path of this.walkCachedSubscriptions(options)) {
            if (path.subscription.subscriptionId.toLowerCase() === wanted) {
                return path.subscription;
            }
        }

        const walkOptions: AzureWalkOptions = {
            ...options,
            onFailure: failure => { this.reportLookupFailure(failure, options); },
        };
        for await (const path of this.walkSubscriptions(walkOptions)) {
            if (path.subscription.subscriptionId.toLowerCase() === wanted) {
                return path.subscription;
            }
        }

        return undefined;
    }

    /**
     * Discard every cached listing.
     *
     * Reserved for an explicit user-driven refresh: re-earning the whole
     * hierarchy costs a token and a round trip per tenant, so nothing should
     * reach for this on the user's behalf. Every automatic response to a change
     * is either narrower (a re-enumeration) or nothing at all.
     */
    public clear(): void {
        this.store.clear();
    }

    /**
     * An account's tenants, with the tenant ids named by
     * {@linkcode AzureListingCacheOptions.additionalTenantIds additionalTenantIds}
     * merged in.
     *
     * The merge happens here, above the cache, rather than being folded into the
     * cached listing -- so the named set is free to change, and a tenant that is
     * both listed and named keeps the real display name the listing gave it.
     *
     * Named tenants join the **terminal** page, so a reader that stops early
     * sees the same prefix it would have seen anyway.
     */
    private async *tenantPages(account: AzureAccount): AsyncIterable<Page<AzureTenant>> {
        const additional = this.additionalTenants(account);
        const seen = new CaselessSet();
        let emittedTerminalPage = false;

        for await (const page of this.tenantListing(account).read()) {
            page.items.forEach(tenant => seen.add(tenant.tenantId));
            if (page.hasMore) {
                yield page;
            } else {
                yield { items: [...page.items, ...additional.filter(tenant => !seen.has(tenant.tenantId))], hasMore: false };
                emittedTerminalPage = true;
            }
        }

        if (!emittedTerminalPage) {
            yield { items: additional.filter(tenant => !seen.has(tenant.tenantId)), hasMore: false };
        }
    }

    /**
     * The cached-only counterpart of
     * {@linkcode AzureListingCache.tenantPages tenantPages}.
     *
     * Named tenants are appended as their own page rather than merged into a
     * terminal one, since the cached pages may stop mid-listing. Page shape does
     * not matter to the only caller (a lookup), and a named tenant that a later
     * page would also have listed lands on the same key either way.
     */
    private cachedTenantPages(account: AzureAccount): Page<AzureTenant>[] {
        const pages = this.store.cachedPages<AzureTenant>(azureListingKey(account));
        const seen = new CaselessSet(pages.flatMap(page => page.items.map(tenant => tenant.tenantId)));
        const additional = this.additionalTenants(account).filter(tenant => !seen.has(tenant.tenantId));
        return additional.length > 0 ? [...pages, { items: additional, hasMore: false }] : pages;
    }

    /**
     * Synthesize {@linkcode AzureTenant}s for the tenant ids named for this
     * account. No display name is available (enumeration is what is blocked), so
     * the tenant id stands in until something upgrades it.
     *
     * Ids are deduplicated case-insensitively: they typically come from
     * user-editable storage, so the same tenant can be named twice.
     */
    private additionalTenants(account: AzureAccount): AzureTenant[] {
        const seen = new CaselessSet();
        const tenants: AzureTenant[] = [];
        for (const tenantId of this.options?.additionalTenantIds?.(account) ?? []) {
            if (seen.has(tenantId)) {
                continue;
            }
            seen.add(tenantId);
            tenants.push({
                tenantId: tenantId.toLowerCase(),
                displayName: tenantId,
                environment: account.environment,
                accountId: account.id,
            } satisfies AzureTenant);
        }
        return tenants;
    }

    /** The cached account with this id, without fetching. */
    private cachedAccount(accountId: string): AzureAccount | undefined {
        const wanted = accountId.toLowerCase();
        return this.store.cachedPages<AzureAccount>(AzureListingRootKey)
            .flatMap(page => page.items)
            .find(account => account.id.toLowerCase() === wanted);
    }

    /**
     * The cached-only counterpart of
     * {@linkcode AzureListingCache.walkSubscriptions walkSubscriptions}: the
     * same descent, reading pages already fetched instead of fetching more.
     *
     * Being synchronous is the guarantee, not an optimization -- there is
     * nowhere for a request to hide.
     */
    private *walkCachedSubscriptions(options?: AzureWalkOptions): Iterable<AzureSubscriptionPath> {
        for (const accountPage of this.store.cachedPages<AzureAccount>(AzureListingRootKey)) {
            for (const account of accountPage.items) {
                if (!visitsAccount(account, options)) {
                    continue;
                }

                for (const tenantPage of this.cachedTenantPages(account)) {
                    for (const tenant of tenantPage.items) {
                        if (!visitsTenant(tenant, options)) {
                            continue;
                        }

                        for (const subscriptionPage of this.store.cachedPages<AzureSubscription>(azureListingKey(tenant))) {
                            for (const subscription of subscriptionPage.items) {
                                yield { account, tenant, subscription };
                            }
                        }
                    }
                }
            }
        }
    }

    private accountListing() {
        return this.store.listing<AzureAccount>(AzureListingRootKey, () => this.fetchAccountsAsPage());
    }

    private tenantListing(account: AzureAccount) {
        return this.store.listing<AzureTenant>(azureListingKey(account), () => this.fetcher.fetchTenants(account));
    }

    private subscriptionListing(tenant: AzureTenant) {
        return this.store.listing<AzureSubscription>(azureListingKey(tenant), () => this.fetcher.fetchSubscriptions(tenant));
    }

    /** Adapt the unpaged accounts fetch to the paged listing the store caches. */
    private async *fetchAccountsAsPage(): AsyncIterable<Page<AzureAccount>> {
        yield { items: await this.fetcher.fetchAccounts(), hasMore: false };
    }

    private reportLookupFailure(failure: AzureListingFailure, options?: AzureWalkOptions): void {
        this.executor.output.debug(`[listing] subscription lookup skipped tenant=${failure.tenant?.tenantId ?? '<all>'}: ${stringifyError(failure.error)}`);
        options?.onFailure?.(failure);
    }
}

/** DI identifier for the {@linkcode AzureListingCache}. */
export const IAzureListingCache: ServiceIdentifier<AzureListingCache> = Symbol.for('IAzureListingCache');

/** Whether a walk narrowed by `options` should descend into this account. */
function visitsAccount(account: AzureAccount, options?: AzureWalkOptions): boolean {
    return !options?.accountId || account.id.toLowerCase() === options.accountId.toLowerCase();
}

/**
 * Whether a walk narrowed by `options` should descend into this tenant -- the
 * one place the filter is consulted, so both walks agree by construction.
 */
function visitsTenant(tenant: AzureTenant, options?: AzureWalkOptions): boolean {
    if (options?.tenantId && tenant.tenantId.toLowerCase() !== options.tenantId.toLowerCase()) {
        return false;
    }
    return options?.filter?.(tenant) ?? true;
}
