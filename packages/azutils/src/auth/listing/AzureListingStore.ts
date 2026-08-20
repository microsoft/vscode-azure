/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CaselessMap, type Page } from '@microsoft/vscode-azure-utils';
import type { AzureAccount, AzureTenant } from '../AzureSubscription';
import type { AzureListingNode } from '../../models/AzureNode';
import { CachedPagedListing } from './CachedPagedListing';

/**
 * The key of the synthetic parent whose children are the accounts.
 *
 * Alone among the keys it carries no environment, because the accounts listing
 * is the one read taken against the *ambient* configured cloud rather than
 * against a node that already knows which cloud it came from. Re-listing it is a
 * local `getAccounts()` call, so a cloud switch re-enumerates it and keeps
 * everything below -- which is environment-keyed and therefore still true.
 */
export const AzureListingRootKey = '';

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
 * The **unfiltered** cache behind {@linkcode AzureListingCache}: one paged
 * listing per parent, keyed by that parent's hierarchical id (see
 * {@linkcode azureListingKey}).
 *
 * The listings are the whole cache -- there is no second index of individual
 * nodes, so a node cannot be reached except by descending through the listing
 * that produced it. That is what lets a lookup apply a filter to a cached node's
 * ancestors for free: it had to pass through them to arrive. It also makes a
 * subscription reachable through two tenants two ordinary entries in two
 * listings, with no special case.
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

    /**
     * The cached listing of the given parent's children, created from `factory`
     * on first use and replayed afterwards.
     *
     * A listing poisoned by a failed pull is replaced rather than returned, so
     * the next read starts a clean listing. Anything already fetched *beneath*
     * the failed parent stays cached: it was paid for and is still true.
     *
     * @param parentKey - The parent's hierarchical key, or
     *   {@linkcode AzureListingRootKey} for the accounts listing.
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
     * The pages already fetched for a parent, without fetching another -- empty
     * when nothing is cached for it.
     *
     * Synchronous by design: a traversal built on this provably issues no
     * request and mints no token.
     */
    public cachedPages<T extends AzureListingNode>(parentKey: string): Page<T>[] {
        const listing = this.listings.get(parentKey);
        return listing && !listing.hasFailed ? listing.cachedPages() as Page<T>[] : [];
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
        this.listings.clear();
    }
}
