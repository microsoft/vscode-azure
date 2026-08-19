/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { stringifyError, type IActionExecutor, type Page } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import { isSubscription } from '../../models/AzureNode';
import type { AzureAccount, AzureSubscription, AzureTenant } from '../AzureSubscription';
import type { IAzureListingFetcher } from './AzureListingFetcher';
import { AzureListingRootKey, azureListingKey, azureListingKeyFor, AzureListingStore, type AzureListingNode } from './AzureListingStore';

/**
 * Decides whether a node takes part in a listing walk.
 *
 * Returning `false` skips the node **and everything beneath it**, before any
 * work is done for it: a skipped tenant never has a tenant-scoped token minted,
 * never has its subscriptions listed, and never reaches the caller at all. That
 * is the point of expressing the filter as a traversal-time predicate rather
 * than a post-hoc `list().filter(...)` -- by the time a listing exists, its cost
 * has already been paid.
 *
 * The predicate is consulted at every level, so one function expresses the whole
 * rule; a caller that only filters tenants and subscriptions simply admits every
 * account.
 */
export type AzureListingFilter = (node: AzureListingNode) => boolean;

/** Options accepted by every {@linkcode AzureListingCache} read. */
export interface AzureListingOptions {
    /**
     * Skip predicate applied during the walk. Omit it to read the unfiltered
     * truth -- which is what a flow that *edits* the filter must do, or the
     * filter could only ever be narrowed.
     */
    readonly filter?: AzureListingFilter;
}

/** A subscription together with the account and tenant it was reached through. */
export interface AzureSubscriptionPath {
    readonly account: AzureAccount;
    readonly tenant: AzureTenant;
    readonly subscription: AzureSubscription;
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
 * caller's filter excluded. Filtering on insert is what makes a filtered read
 * poison a later unfiltered one.
 *
 * Two consequences follow, and both are the point:
 *
 * - A filtered read followed by an unfiltered read fetches only the delta.
 *   Caching is per **parent listing**, not per query, so any walk hits or misses
 *   node by node rather than as a whole.
 * - Changing which subset a product shows needs no invalidation at all: a filter
 *   change makes no cached listing untrue.
 *
 * Invalidation is correspondingly narrow. {@linkcode AzureListingCache.clear clear}
 * only when the data stops being true (the configured cloud changed, or the set
 * of manually-named tenants did); {@linkcode AzureListingCache.clearAccount clearAccount}
 * for a single sign-out; {@linkcode AzureListingCache.refreshAccounts refreshAccounts}
 * for a sign-in, which re-lists accounts without discarding what is cached
 * beneath the accounts that were already there.
 */
export class AzureListingCache {
    private readonly store = new AzureListingStore();

    public constructor(
        private readonly fetcher: IAzureListingFetcher,
        private readonly executor: IActionExecutor,
    ) { }

    /**
     * The accounts signed in for the configured environment.
     *
     * Cached: concurrent callers share one fetch, and later callers replay it. A
     * failed fetch is not retained, so the next call retries.
     */
    public async listAccounts(options?: AzureListingOptions): Promise<AzureAccount[]> {
        const accounts: AzureAccount[] = [];
        for await (const page of this.accountListing().read()) {
            accounts.push(...page.items);
        }
        return admit(accounts, options?.filter);
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
     * Only the accounts listing is discarded. Tenants and subscriptions already
     * cached under accounts that are still present stay cached -- a new account
     * signing in does not make another account's tenants untrue.
     */
    public async refreshAccounts(): Promise<AzureAccount[]> {
        this.store.evictListing(AzureListingRootKey);
        return this.listAccounts();
    }

    /**
     * An account's tenants, one page at a time, pulling only as far as the
     * reader asks.
     */
    public listTenants(account: AzureAccount, options?: AzureListingOptions): AsyncIterable<Page<AzureTenant>> {
        const listing = this.store.listing<AzureTenant>(
            azureListingKey(account),
            () => this.fetcher.fetchTenants(account),
        );
        return admitPages(listing.read(), options?.filter);
    }

    /**
     * A tenant's subscriptions, one page at a time, pulling only as far as the
     * reader asks.
     */
    public listSubscriptions(tenant: AzureTenant, options?: AzureListingOptions): AsyncIterable<Page<AzureSubscription>> {
        const listing = this.store.listing<AzureSubscription>(
            azureListingKey(tenant),
            () => this.fetcher.fetchSubscriptions(tenant),
        );
        return admitPages(listing.read(), options?.filter);
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
        const wantedAccount = options?.accountId?.toLowerCase();
        const wantedTenant = options?.tenantId?.toLowerCase();

        for (const account of await this.listAccounts(options)) {
            if (wantedAccount && account.id.toLowerCase() !== wantedAccount) {
                continue;
            }

            try {
                for await (const tenantPage of this.listTenants(account, options)) {
                    for (const tenant of tenantPage.items) {
                        if (wantedTenant && tenant.tenantId.toLowerCase() !== wantedTenant) {
                            continue;
                        }

                        try {
                            for await (const subscriptionPage of this.listSubscriptions(tenant, options)) {
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
     * The same filter that governs the tree governs this lookup: a subscription
     * the filter excludes does not resolve. The caller gets `undefined` and
     * degrades; it is never an error and never a prompt, because prompting for a
     * tenant the user deselected is the very thing the filter exists to prevent.
     *
     * A subscription id alone can legitimately match more than one node (the
     * same subscription reached through two tenants). Cached matches are
     * therefore resolved by an explicit tie-break -- prefer the copy listed
     * through the subscription's own home tenant, then the lowest account id,
     * then the lowest tenant id -- rather than by whichever happened to be found
     * first. Only when nothing is cached does it walk, taking the first match in
     * walk order.
     *
     * @param subscriptionId - The subscription id to resolve.
     * @param options - Optional account/tenant narrowing, the filter, and a
     *   failure sink. Narrowing avoids listing tenants that cannot hold the
     *   answer.
     */
    public async findSubscription(subscriptionId: string, options?: AzureWalkOptions): Promise<AzureSubscription | undefined> {
        const wanted = subscriptionId.toLowerCase();
        const wantedAccount = options?.accountId?.toLowerCase();
        const wantedTenant = options?.tenantId?.toLowerCase();
        const filter = options?.filter;

        const cached: AzureSubscription[] = [];
        for (const node of this.store.scan()) {
            if (!isSubscription(node) || node.subscriptionId.toLowerCase() !== wanted) {
                continue;
            }
            if (wantedAccount && node.accountId.toLowerCase() !== wantedAccount) {
                continue;
            }
            if (wantedTenant && node.tenantId.toLowerCase() !== wantedTenant) {
                continue;
            }
            if (filter && !filter(node)) {
                continue;
            }
            cached.push(node);
        }

        if (cached.length > 0) {
            return cached.sort(preferHomeTenant)[0];
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
     * Evict one account and everything cached beneath it, leaving other accounts
     * untouched. Use when that account signs out.
     */
    public clearAccount(accountId: string): void {
        this.store.evict(azureListingKeyFor(accountId));
    }

    /**
     * Discard every cached listing.
     *
     * Reserved for changes that make the data itself untrue -- the configured
     * cloud (the endpoints changed) or the set of manually-named tenants (they
     * fold into tenant listings). A change to which subscriptions a product
     * *shows* is not one of these.
     */
    public clear(): void {
        this.store.clear();
    }

    private accountListing() {
        return this.store.listing<AzureAccount>(AzureListingRootKey, () => this.fetchAccountsAsPage());
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

/**
 * Order two copies of the same subscription: the one listed through its home
 * tenant first (it is the copy with the subscription's own authorization rather
 * than a guest or delegated grant), then by account id, then by tenant id, so
 * the choice is stable across sessions.
 */
function preferHomeTenant(a: AzureSubscription, b: AzureSubscription): number {
    const isHome = (sub: AzureSubscription) => sub.homeTenantId?.toLowerCase() === sub.tenantId.toLowerCase();
    if (isHome(a) !== isHome(b)) {
        return isHome(a) ? -1 : 1;
    }
    return a.accountId.toLowerCase().localeCompare(b.accountId.toLowerCase())
        || a.tenantId.toLowerCase().localeCompare(b.tenantId.toLowerCase());
}

/** Apply a filter to an already-materialized list. */
function admit<T extends AzureListingNode>(items: T[], filter?: AzureListingFilter): T[] {
    return filter ? items.filter(item => filter(item)) : items;
}

/**
 * Apply a filter to each page as it arrives, preserving page boundaries and the
 * `hasMore` flags so the reader's paging is unaffected by how many items a page
 * lost. Filtering here -- rather than after a listing is materialized -- is what
 * keeps a skipped node from ever reaching a caller that would then drill it.
 */
async function* admitPages<T extends AzureListingNode>(pages: AsyncIterable<Page<T>>, filter?: AzureListingFilter): AsyncIterable<Page<T>> {
    for await (const page of pages) {
        yield filter ? { items: page.items.filter(item => filter(item)), hasMore: page.hasMore } : page;
    }
}
