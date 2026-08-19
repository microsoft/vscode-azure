/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CaselessMap, type Page } from '@microsoft/vscode-azure-utils';
import type { AzureAccount, AzureTenant } from '../AzureSubscription';
import type { AzureListingNode } from '../../models/AzureNode';
import { isTenant } from '../../models/AzureNode';
import { CachedPagedListing } from './CachedPagedListing';

/**
 * The key of the synthetic parent whose children are the accounts. The empty
 * string keeps every real key a `parent/child` path beneath it, so the accounts
 * listing obeys the same eviction rules as the rest of the hierarchy.
 */
export const AzureListingRootKey = '';

/**
 * Build the key of the listing whose children are the given parent's -- an
 * account's tenants (`{accountId}`) or a tenant's subscriptions
 * (`{accountId}/{tenantId}`).
 *
 * Each segment is percent-encoded before being joined, because a VS Code
 * authentication account id is an opaque provider string that may itself
 * contain a `/` -- which would otherwise let one account's key masquerade as
 * another account's descendant and make subtree eviction delete the wrong
 * entries.
 *
 * Keys are compared case-insensitively by {@linkcode AzureListingStore}, so the
 * casing each id arrives with is preserved rather than folded here.
 */
export function azureListingKeyFor(accountId: string, tenantId?: string): string {
    const segments = tenantId === undefined ? [accountId] : [accountId, tenantId];
    return segments.map(segment => encodeURIComponent(segment)).join('/');
}

/** Build the key of the listing holding this node's children. See {@linkcode azureListingKeyFor}. */
export function azureListingKey(node: AzureAccount | AzureTenant): string {
    return isTenant(node) ? azureListingKeyFor(node.accountId, node.tenantId) : azureListingKeyFor(node.id);
}

/** The prefix every descendant key of `key` starts with. */
function childPrefix(key: string): string {
    return key === AzureListingRootKey ? key : `${key}/`;
}

/**
 * The **unfiltered** cache behind {@linkcode AzureListingCache}: one paged
 * listing per parent, keyed by that parent's hierarchical id (see
 * {@linkcode azureListingKeyFor}).
 *
 * The listings are the whole cache -- there is no second index of individual
 * nodes, so a node cannot be reached except by descending through the listing
 * that produced it. That is what lets a lookup apply a filter to a cached node's
 * ancestors for free: it had to pass through them to arrive. It also makes a
 * subscription reachable through two tenants two ordinary entries in two
 * listings, with no special case, and subtree eviction a single prefix scan.
 *
 * The store holds no notion of who wanted the data or which subset a product
 * currently shows: anything fetched is stored. Filtering happens above it, when
 * a listing is read.
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
     * Evict a parent's listing and every listing beneath it.
     *
     * Covers both "this node is gone" (an account that signed out) and "this
     * node is still true, but nothing under it is" (an interactive sign-in can
     * have authorized tenants that were invisible when the account was last
     * listed): a node is not cached apart from its parent's listing, so there is
     * nothing to keep or discard that would tell the two cases apart.
     */
    public evict(parentKey: string): void {
        this.listings.delete(parentKey);

        const prefix = childPrefix(parentKey).toLowerCase();
        for (const [key] of this.listings) {
            if (key.toLowerCase().startsWith(prefix)) {
                this.listings.delete(key);
            }
        }
    }

    /**
     * Drop only the cached listing of a parent's children, keeping everything
     * beneath them -- the narrow invalidation for "the *set* may have changed,
     * but what is under each surviving member has not". Re-listing accounts
     * after a sign-in must not discard the tenants and subscriptions already
     * fetched for the accounts that were already there.
     */
    public evictListing(parentKey: string): void {
        this.listings.delete(parentKey);
    }

    /** Drop everything. */
    public clear(): void {
        this.listings.clear();
    }
}
