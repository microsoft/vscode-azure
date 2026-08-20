/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CaselessMap, type Page } from '@microsoft/vscode-azure-utils';
import type { AzureAccount, AzureTenant } from '../AzureSubscription';
import type { AzureListingNode } from '../../models/AzureNode';
import { CachedPagedListing } from './CachedPagedListing';

/**
 * A parent whose children are a cached listing: an account (whose children are
 * tenants) or a tenant (whose children are subscriptions).
 *
 * The tenant side is a {@linkcode Pick} rather than a whole
 * {@linkcode AzureTenant} because a caller may hold only ids -- a tenant the
 * user named by hand is never part of a cached tenant listing, yet its
 * subscriptions are cached like any other's.
 */
export type AzureListingParent = AzureAccount | Pick<AzureTenant, 'environment' | 'accountId' | 'tenantId'>;

/**
 * Build the key of the listing whose children are the given parent's -- an
 * account's tenants (`{environment}/{accountId}`) or a tenant's subscriptions
 * (`{environment}/{accountId}/{tenantId}`).
 *
 * The environment leads the key so listings from different clouds coexist rather
 * than collide, which is what lets a cloud switch discard nothing: the same
 * account id can be issued by both the public and the sovereign auth provider,
 * and the data behind it is entirely different. It is identified by its
 * resource-manager endpoint alone -- that is what the listings were actually
 * fetched from, so two clouds sharing it hold the same data whatever they are
 * called, and a custom cloud whose endpoint the user edits gets a new key
 * without having to be renamed.
 *
 * Each segment is percent-encoded before being joined, because a VS Code
 * authentication account id is an opaque provider string that may itself
 * contain a `/` -- which would otherwise let one account's key masquerade as
 * another account's descendant.
 *
 * Keys are compared case-insensitively by {@linkcode AzureListingStore}, so the
 * casing each id arrives with is preserved rather than folded here.
 */
export function azureListingKey(parent: AzureListingParent): string {
    const segments = 'tenantId' in parent
        ? [parent.environment.resourceManagerEndpointUrl, parent.accountId, parent.tenantId]
        : [parent.environment.resourceManagerEndpointUrl, parent.id];
    return segments.map(segment => encodeURIComponent(segment)).join('/');
}

/**
 * The **unfiltered** cache behind {@linkcode AzureListingCache}: the accounts,
 * plus one paged listing per parent below them, keyed by that parent's
 * hierarchical id (see {@linkcode azureListingKey}).
 *
 * The accounts are held apart from the keyed listings because they are not one.
 * They arrive unpaged from a local `getAccounts()` call, and alone among the
 * cached sets they are read against the *ambient* configured cloud rather than
 * against a node that already knows which cloud it came from -- so there is no
 * environment to lead a key with. A cloud switch therefore re-enumerates the
 * accounts and keeps everything below them, which is environment-keyed and so
 * still true.
 *
 * Neither half is an index of individual nodes: a node cannot be reached except
 * by descending through the listing that produced it. That is what lets a lookup
 * apply a filter to a cached node's ancestors for free -- it had to pass through
 * them to arrive. It also makes a subscription reachable through two tenants two
 * ordinary entries in two listings, with no special case.
 *
 * The store holds no notion of who wanted the data or which subset a product
 * currently shows: anything fetched is stored. Filtering happens above it, when
 * a listing is read.
 *
 * **Listings are expensive and rarely wrong.** The tenants an account can see,
 * and the subscriptions in a tenant, change on the order of weeks, while
 * fetching them costs a token and a round trip per tenant. So the store offers
 * one narrow verb -- {@linkcode AzureListingStore.evictListing evictListing},
 * "this child *set* may have changed" -- and one blunt one,
 * {@linkcode AzureListingStore.clear clear}, for the rare case where the data is
 * genuinely untrue or the user explicitly asked for it. Making data *unreachable*
 * (by filtering it, or by its parent dropping out of a listing) is preferred over
 * discarding it: an unreachable listing costs only memory, and re-earning it
 * costs the user a wait.
 */
export class AzureListingStore {
    private readonly listings = new CaselessMap<CachedPagedListing<AzureListingNode>>();
    private accountsPromise: Promise<AzureAccount[]> | undefined;
    private accountsResult: AzureAccount[] | undefined;

    /**
     * The signed-in accounts, fetched through `factory` on first use and
     * replayed afterwards.
     *
     * Concurrent callers share one fetch. A failed fetch is not retained, so the
     * next call retries -- the same "poisoned listings are replaced" rule the
     * keyed listings follow, which is safe here only because the accounts arrive
     * whole: there is no partial result a retry could splice onto.
     *
     * A fetch that {@linkcode AzureListingStore.evictAccounts evictAccounts}
     * overtakes still returns to its own caller, but is abandoned rather than
     * cached, so an eviction is never undone by a read that predates it.
     */
    public async accounts(factory: () => Promise<AzureAccount[]>): Promise<AzureAccount[]> {
        const pending = this.accountsPromise ??= factory().catch((error: unknown) => {
            this.accountsPromise = undefined;
            throw error;
        });

        const accounts = await pending;
        if (this.accountsPromise === pending) {
            this.accountsResult = accounts;
        }
        return accounts;
    }

    /**
     * The accounts already fetched, without fetching -- `undefined` when none
     * have been.
     *
     * Synchronous by design, so a caller that only needs to *name* something it
     * has already paid for cannot accidentally pay again.
     */
    public cachedAccounts(): AzureAccount[] | undefined {
        return this.accountsResult;
    }

    /**
     * Discard the accounts so the next read asks again, keeping every listing
     * beneath them.
     */
    public evictAccounts(): void {
        this.accountsPromise = undefined;
        this.accountsResult = undefined;
    }

    /**
     * The cached listing of the given parent's children, created from `factory`
     * on first use and replayed afterwards.
     *
     * A listing poisoned by a failed pull is replaced rather than returned, so
     * the next read starts a clean listing. Anything already fetched *beneath*
     * the failed parent stays cached: it was paid for and is still true.
     *
     * @param parentKey - The parent's hierarchical key.
     * @param factory - Produces the underlying listing on a cache miss.
     */
    public listing<T extends AzureListingNode>(parentKey: string, factory: () => AsyncIterable<Page<T>>): CachedPagedListing<T> {
        const existing = this.listings.get(parentKey);
        if (existing && !existing.hasFailed) {
            return existing as CachedPagedListing<T>;
        }

        const created = new CachedPagedListing<T>(factory);
        this.listings.set(parentKey, created);
        return created;
    }

    /**
     * Drop the cached listing of a parent's children, keeping everything
     * beneath them.
     *
     * This is the store's only narrow invalidation, and it means "the child
     * *set* may have changed", not "what I fetched was wrong". Re-listing is
     * lossless here because keys are paths: the children come back under the
     * keys they had, so every listing beneath them re-attaches untouched. A
     * child that is genuinely new costs one listing; the rest costs nothing.
     */
    public evictListing(parentKey: string): void {
        this.listings.delete(parentKey);
    }

    /**
     * Drop everything.
     *
     * Reserved for the two cases that justify paying to re-fetch the whole
     * hierarchy: the user explicitly asked for fresh data, or the data is
     * genuinely untrue. Reach for {@linkcode AzureListingStore.evictListing evictListing}
     * otherwise.
     */
    public clear(): void {
        this.evictAccounts();
        this.listings.clear();
    }
}
