/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { filterPages, Limiter, type IActionExecutor, type Page } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import type { AzureAccount, AzureSubscription, AzureTenant } from '../AzureSubscription';
import { additionalTenantsFor, withAdditionalTenants } from './additionalTenants';
import type { IAzureListingFetcher } from './AzureListingFetcher';
import { azureListingKey, AzureListingStore } from './AzureListingStore';

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
export interface AzureWalkOptions {
    /**
     * Skip predicate applied during the walk. Omit it to read the unfiltered
     * truth -- which is what a flow that *edits* the filter must do, or the
     * filter could only ever be narrowed.
     */
    readonly filter?: AzureTenantFilter;
    /**
     * How many tenants may have their subscriptions listed at once. Defaults to
     * `1`, which walks strictly sequentially.
     *
     * Raise it for a consumer that is going to drain the walk anyway -- a pick
     * list over every reachable subscription spends a token request plus a
     * listing per tenant, and across dozens of tenants that is seconds of
     * serialized latency for work with no ordering dependency between tenants.
     *
     * Leave it at `1` for anything that stops early. A walk with a window of `n`
     * has up to `n - 1` tenants in flight past the one being read, so a consumer
     * that breaks on the first match would issue token requests for tenants it
     * never needed -- and a token request is the thing most capable of
     * interrupting the user. Output order is unaffected either way.
     */
    readonly concurrency?: number;
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
 * {@linkcode AzureListingCache.reenumerateSubscriptions reenumerateSubscriptions} /
 * {@linkcode AzureListingCache.reenumerateAccounts reenumerateAccounts} for
 * "this child set may have grown", and {@linkcode AzureListingCache.clear clear}
 * for the rare case where the user asked for fresh data outright. */
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
        return this.store.accounts(() => this.fetcher.fetchAccounts());
    }

    /**
     * Discard the accounts listing so the next read asks again, keeping every
     * tenant and subscription listing beneath it.
     *
     * Pair it with {@linkcode AzureListingCache.listAccounts listAccounts} to
     * answer "did the signed-in account set change?" -- asking `listAccounts`
     * alone would replay the memo and always answer "no". The re-list that
     * follows a detected change is then served from the freshly seeded memo
     * rather than fetching a second time.
     *
     * Cheap: listing accounts is a local `getAccounts()` call with no network
     * behind it. It is also the whole response to a cloud switch, since every
     * key below the root carries its environment and so the previous cloud's
     * listings neither collide with the new cloud's nor need discarding.
     */
    public reenumerateAccounts(): void {
        this.store.evictAccounts();
    }

    /**
     * Discard one tenant's subscription listing so the next read asks again.
     *
     * For "signing in to this tenant may have authorized subscriptions that were
     * invisible when it was last listed". Nothing else is touched: the tenant
     * itself is still true, and so is every other tenant's listing.
     *
     * A no-op when the account is not cached, which is the honest answer: the
     * cache reaches a tenant only by descending from its account, so no cached
     * account means no cached subscription listing to re-ask for.
     *
     * @param tenant - The tenant to re-list, or any object naming its account
     * and tenant ids -- so a caller holding an {@linkcode AzureTenant} can pass
     * it straight through.
     */
    public reenumerateSubscriptions(tenant: Pick<AzureTenant, 'accountId' | 'tenantId'>): void {
        const account = this.cachedAccount(tenant.accountId);
        if (account) {
            this.store.evictListing(azureListingKey({ ...tenant, environment: account.environment }));
        }
    }

    /**
     * An account's tenants, one page at a time, pulling only as far as the
     * reader asks.
     *
     * Excluded tenants are dropped from their page rather than the page being
     * dropped, so the reader's paging is unaffected by how many a page loses.
     */
    public listTenants(account: AzureAccount, filter?: AzureTenantFilter): AsyncIterable<Page<AzureTenant>> {
        return filterPages(this.tenantPages(account), filter);
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
     *
     * Tenants may be listed concurrently -- see
     * {@linkcode AzureWalkOptions.concurrency concurrency} -- but the order
     * subscriptions are yielded in never varies with it.
     */
    public async *walkSubscriptions(options?: AzureWalkOptions): AsyncIterable<AzureSubscriptionPath> {
        const concurrency = Math.max(1, Math.floor(options?.concurrency ?? 1));

        if (concurrency === 1) {
            for await (const { account, tenant } of this.walkTenants(options)) {
                yield* this.tenantSubscriptions(account, tenant, options);
            }
            return;
        }

        // A sliding window of in-flight tenant listings, drained oldest-first so
        // the yield order matches the sequential walk exactly. The window is
        // filled from the tenant walk itself, which stays lazy: tenant pages are
        // pulled only as slots open up, so a huge account is never enumerated
        // ahead of the work it feeds.
        const limiter = new Limiter<AzureSubscriptionPath[]>(concurrency);
        const inFlight: Array<Promise<AzureSubscriptionPath[]>> = [];

        for await (const { account, tenant } of this.walkTenants(options)) {
            inFlight.push(limiter.queue(() => this.collectTenantSubscriptions(account, tenant, options)));
            while (inFlight.length >= concurrency) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                yield* await inFlight.shift()!;
            }
        }

        for (const pending of inFlight) {
            yield* await pending;
        }
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
     * The account/tenant pairs a walk should descend into, in order.
     *
     * The tenant filter is applied here -- before the tenant is handed to
     * anything that would touch it -- which is what makes an excluded tenant
     * cost nothing at all: no token, no listing, no enrichment. A failure to
     * enumerate one account's tenants is isolated so the walk still reaches
     * every other account.
     */
    private async *walkTenants(options?: AzureWalkOptions): AsyncIterable<{ account: AzureAccount; tenant: AzureTenant }> {
        for (const account of await this.listAccounts()) {
            try {
                for await (const page of this.tenantPages(account)) {
                    for (const tenant of page.items) {
                        if (options?.filter?.(tenant) ?? true) {
                            yield { account, tenant };
                        }
                    }
                }
            } catch (error) {
                options?.onFailure?.({ account, error });
            }
        }
    }

    /**
     * One tenant's subscriptions as walk paths, streamed page by page. A listing
     * that fails is reported and ends the tenant rather than the walk.
     */
    private async *tenantSubscriptions(account: AzureAccount, tenant: AzureTenant, options?: AzureWalkOptions): AsyncIterable<AzureSubscriptionPath> {
        try {
            for await (const page of this.listSubscriptions(tenant)) {
                for (const subscription of page.items) {
                    yield { account, tenant, subscription };
                }
            }
        } catch (error) {
            options?.onFailure?.({ account, tenant, error });
        }
    }

    /**
     * {@linkcode AzureListingCache.tenantSubscriptions tenantSubscriptions}
     * buffered, for the concurrent walk -- which needs a promise per tenant to
     * put in flight. Never rejects, so an abandoned window leaves no unhandled
     * rejection behind.
     */
    private async collectTenantSubscriptions(account: AzureAccount, tenant: AzureTenant, options?: AzureWalkOptions): Promise<AzureSubscriptionPath[]> {
        const paths: AzureSubscriptionPath[] = [];
        for await (const path of this.tenantSubscriptions(account, tenant, options)) {
            paths.push(path);
        }
        return paths;
    }

    /**
     * An account's tenants, with the tenant ids named by
     * {@linkcode AzureListingCacheOptions.additionalTenantIds additionalTenantIds}
     * merged in above the cache.
     */
    private tenantPages(account: AzureAccount): AsyncIterable<Page<AzureTenant>> {
        return withAdditionalTenants(
            this.tenantListing(account).read(),
            additionalTenantsFor(account, this.options?.additionalTenantIds?.(account) ?? []),
        );
    }

    /** The cached account with this id, without fetching. */
    private cachedAccount(accountId: string): AzureAccount | undefined {
        const wanted = accountId.toLowerCase();
        return this.store.cachedAccounts()?.find(account => account.id.toLowerCase() === wanted);
    }

    private tenantListing(account: AzureAccount) {
        return this.store.listing<AzureTenant>(azureListingKey(account), () => this.fetcher.fetchTenants(account));
    }

    private subscriptionListing(tenant: AzureTenant) {
        return this.store.listing<AzureSubscription>(azureListingKey(tenant), () => this.fetcher.fetchSubscriptions(tenant));
    }
}

/** DI identifier for the {@linkcode AzureListingCache}. */
export const IAzureListingCache: ServiceIdentifier<AzureListingCache> = Symbol.for('IAzureListingCache');
