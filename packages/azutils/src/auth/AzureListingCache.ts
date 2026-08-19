/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Page } from '@microsoft/vscode-azure-utils';
import type { ConcreteAzureNode } from '../models/AzureNode';
import type { AzureAccount, AzureTenant } from './AzureSubscription';

/**
 * The raw account -> tenant -> subscription listings, as fetched from Azure.
 *
 * This is the *unfiltered truth*: every account the user is signed in to, every
 * tenant of each account, and every subscription of each tenant. Any
 * product-specific notion of which subscriptions the user has chosen to see is
 * applied by callers on top of this, never baked into it.
 */
export interface IAzureListingSource {
    /** List every signed-in account for the configured environment. */
    listAccounts(): Promise<AzureAccount[]>;
    /** List every tenant of an account, one page at a time. */
    listTenantsForAccount(account: AzureAccount): AsyncIterable<Page<ConcreteAzureNode>>;
    /** List every subscription of a tenant, one page at a time. */
    listSubscriptionsForTenant(tenant: AzureTenant): AsyncIterable<Page<ConcreteAzureNode>>;
}

/**
 * A lazily-consumed paged listing that remembers the pages it has already
 * produced, so a second reader replays them instead of re-fetching.
 *
 * Pages are pulled from the underlying iterator only as far as a reader actually
 * asks for them, which preserves the caller's ability to read just the first
 * page of a very long listing. A later reader that wants more resumes pulling
 * from the same iterator and appends to the same page list, so a partially-read
 * listing is completed rather than restarted.
 *
 * Concurrent readers are safe: a pull that is already in flight is shared rather
 * than duplicated, so overlapping reads never issue the same request twice.
 *
 * A pull that throws is **not** cached -- the error propagates to the waiting
 * readers, the partially-fetched pages are discarded, and the next read starts a
 * fresh listing. This matters because a listing can fail for transient reasons
 * (an expired session, a network blip), and retaining an empty or truncated
 * result would strand the caller until a full invalidation.
 */
export class CachedPagedListing<T> {
    private readonly pages: Page<T>[] = [];
    private iterator: AsyncIterator<Page<T>> | undefined;
    private exhausted = false;
    private pending: Promise<boolean> | undefined;

    /**
     * @param factory - Produces the underlying listing. Called at most once, on
     * the first pull; replays and resumed reads reuse the iterator it returned.
     */
    public constructor(private readonly factory: () => AsyncIterable<Page<T>>) { }

    /**
     * Read the listing from the beginning, replaying cached pages first and
     * fetching further pages only if the reader keeps asking.
     */
    public async *read(): AsyncIterable<Page<T>> {
        let index = 0;

        for (; ;) {
            if (index < this.pages.length) {
                yield this.pages[index++];
                continue;
            }

            if (this.exhausted || !await this.advance()) {
                return;
            }
        }
    }

    /**
     * Pull one more page, coalescing with any pull already in flight so
     * concurrent readers share a single request.
     *
     * @returns `true` if a page was appended, `false` if the listing ended.
     */
    private advance(): Promise<boolean> {
        this.pending ??= this.pullNext().finally(() => { this.pending = undefined; });
        return this.pending;
    }

    private async pullNext(): Promise<boolean> {
        if (this.exhausted) {
            return false;
        }

        try {
            this.iterator ??= this.factory()[Symbol.asyncIterator]();
            const result = await this.iterator.next();
            if (result.done) {
                this.exhausted = true;
                return false;
            }

            this.pages.push(result.value);
            return true;
        } catch (error) {
            // Discard the partial state: the iterator is spent once it has
            // thrown, and the pages already pulled came from a listing that
            // never completed. Dropping both lets the next read start a clean
            // listing instead of resuming a broken one or replaying a truncated
            // result as if it were whole.
            this.iterator = undefined;
            this.pages.length = 0;
            throw error;
        }
    }
}

/** Lowercased composite key identifying a tenant within its account. */
function tenantKey(tenant: AzureTenant): string {
    return `${tenant.accountId.toLowerCase()}/${tenant.tenantId.toLowerCase()}`;
}

/**
 * Caches the unfiltered account/tenant/subscription listings, so data fetched
 * once can serve every consumer that needs it.
 *
 * Wraps an {@linkcode IAzureListingSource} and satisfies the same interface, so
 * it can be substituted wherever the raw source is used.
 *
 * The cache deliberately holds the **unfiltered truth**. A product that shows
 * the user a subset (for example, only the subscriptions they selected) should
 * apply that filter when *reading* from the cache rather than restricting what
 * gets stored. Two consequences follow, and both are the point:
 *
 * - Data loaded for one purpose is reusable for another. A flow that must see
 *   past the filter -- picking which subscriptions to show, signing in to a new
 *   tenant -- populates the same cache the filtered views read.
 * - Changing the filter is free. It does not make anything already cached
 *   untrue, so it needs no invalidation at all; only the read-side filter
 *   changes.
 *
 * Call {@linkcode AzureListingCache.clear} when the data itself stops being
 * true: the signed-in accounts changed, or the configured cloud endpoint
 * changed. Listings are otherwise kept indefinitely, since account, tenant, and
 * subscription membership change far more rarely than the tree is browsed.
 */
export class AzureListingCache implements IAzureListingSource {
    private accounts: Promise<AzureAccount[]> | undefined;
    private readonly tenants = new Map<string, CachedPagedListing<ConcreteAzureNode>>();
    private readonly subscriptions = new Map<string, CachedPagedListing<ConcreteAzureNode>>();

    public constructor(private readonly source: IAzureListingSource) { }

    /** @inheritdoc */
    public async listAccounts(): Promise<AzureAccount[]> {
        // Cache the promise, not the result, so concurrent callers share one
        // request. A rejection is not retained: clearing on failure lets the
        // next call retry rather than replaying the error forever.
        this.accounts ??= this.source.listAccounts().catch((error: unknown) => {
            this.accounts = undefined;
            throw error;
        });

        return this.accounts;
    }

    /** @inheritdoc */
    public listTenantsForAccount(account: AzureAccount): AsyncIterable<Page<ConcreteAzureNode>> {
        return this.listingFor(this.tenants, account.id.toLowerCase(), () => this.source.listTenantsForAccount(account));
    }

    /** @inheritdoc */
    public listSubscriptionsForTenant(tenant: AzureTenant): AsyncIterable<Page<ConcreteAzureNode>> {
        return this.listingFor(this.subscriptions, tenantKey(tenant), () => this.source.listSubscriptionsForTenant(tenant));
    }

    /**
     * Discard every cached listing.
     *
     * Call this when the cached data is no longer true -- the configured
     * environment changed, so the listings were fetched against a different
     * endpoint. Do *not* call it merely because a display filter changed.
     */
    public clear(): void {
        this.accounts = undefined;
        this.tenants.clear();
        this.subscriptions.clear();
    }

    /**
     * Re-fetch the account list, replacing whatever was cached.
     *
     * Use this when the set of signed-in accounts may have changed. Per-account
     * tenant and subscription listings are left intact, since the accounts that
     * remain are unaffected and re-fetching them would be wasted work; pair this
     * with {@linkcode AzureListingCache.clearAccount} for accounts that went
     * away.
     *
     * @returns The freshly-fetched accounts, which also become the cached list.
     */
    public refreshAccounts(): Promise<AzureAccount[]> {
        this.accounts = undefined;
        return this.listAccounts();
    }

    /**
     * Discard everything cached beneath a single account: its tenant listing and
     * the subscription listing of each of its tenants.
     *
     * @param accountId - The account id, matched case-insensitively.
     */
    public clearAccount(accountId: string): void {
        const key = accountId.toLowerCase();
        this.tenants.delete(key);

        const prefix = `${key}/`;
        for (const tenant of this.subscriptions.keys()) {
            if (tenant.startsWith(prefix)) {
                this.subscriptions.delete(tenant);
            }
        }
    }

    private listingFor(
        map: Map<string, CachedPagedListing<ConcreteAzureNode>>,
        key: string,
        factory: () => AsyncIterable<Page<ConcreteAzureNode>>,
    ): AsyncIterable<Page<ConcreteAzureNode>> {
        let listing = map.get(key);
        if (!listing) {
            listing = new CachedPagedListing(factory);
            map.set(key, listing);
        }

        return listing.read();
    }
}
