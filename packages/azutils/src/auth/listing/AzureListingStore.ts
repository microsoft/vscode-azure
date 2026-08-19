/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CaselessMap, type Page } from '@microsoft/vscode-azure-utils';
import { isSubscription, isTenant, type AzureListingNode } from '../../models/AzureNode';
import { CachedPagedListing } from './CachedPagedListing';

/**
 * The key of the synthetic parent whose children are the accounts. Using the
 * empty string keeps every real key a suffix of a `parent/child` path, so the
 * accounts listing participates in the same lookup and eviction rules as the
 * rest of the hierarchy.
 */
export const AzureListingRootKey = '';

/**
 * Build the hierarchical key for an id triple. Later segments may be omitted to
 * address a shallower level:
 *
 * ```
 * account       {accountId}
 * tenant        {accountId}/{tenantId}
 * subscription  {accountId}/{tenantId}/{subscriptionId}
 * ```
 *
 * Each segment is percent-encoded before being joined. A VS Code authentication
 * account id is an opaque provider string that may itself contain a `/`, which
 * would otherwise let one account's key masquerade as another account's
 * descendant and make subtree eviction delete the wrong entries.
 *
 * Keys are compared case-insensitively by {@linkcode AzureListingStore}, so the
 * casing each id arrives with is preserved rather than folded here.
 */
export function azureListingKeyFor(accountId: string, tenantId?: string, subscriptionId?: string): string {
    const segments = [accountId];
    if (tenantId !== undefined) {
        segments.push(tenantId);
        if (subscriptionId !== undefined) {
            segments.push(subscriptionId);
        }
    }
    return segments.map(segment => encodeURIComponent(segment)).join('/');
}

/** Build the hierarchical key identifying a node. See {@linkcode azureListingKeyFor}. */
export function azureListingKey(node: AzureListingNode): string {
    if (isSubscription(node)) {
        return azureListingKeyFor(node.accountId, node.tenantId, node.subscriptionId);
    }
    if (isTenant(node)) {
        return azureListingKeyFor(node.accountId, node.tenantId);
    }
    return azureListingKeyFor(node.id);
}

/** The prefix every descendant key of `key` starts with. */
function childPrefix(key: string): string {
    return key === AzureListingRootKey ? key : `${key}/`;
}

/**
 * The flat, **unfiltered** cache behind {@linkcode AzureListingCache}: every
 * account, tenant, and subscription that has ever been listed, keyed by its
 * hierarchical id (see {@linkcode azureListingKeyFor}).
 *
 * Flat keys rather than nested maps make a subscription that is reachable
 * through two tenants two ordinary entries -- `{account}/{tenantA}/{sub}` and
 * `{account}/{tenantB}/{sub}` -- with no special case, and no key anywhere that
 * reduces to a bare subscription id.
 *
 * The store holds no notion of who wanted the data or which subset a product
 * currently shows: anything fetched is stored. Filtering happens above it, when
 * a listing is read.
 *
 * Two facts are kept per parent key: the paged listing of its children (which
 * knows whether it ran to completion, so "no children cached" is
 * distinguishable from "cached, and there are none") and, for lookups, the
 * child nodes themselves indexed by their own keys.
 */
export class AzureListingStore {
    private readonly nodes = new CaselessMap<AzureListingNode>();
    private readonly listings = new CaselessMap<CachedPagedListing<AzureListingNode>>();

    /**
     * The cached listing of the given parent's children, created from `factory`
     * on first use and replayed afterwards.
     *
     * Items are indexed into the store as pages arrive, so a node fetched for
     * one caller is immediately visible to {@linkcode AzureListingStore.get get}
     * and {@linkcode AzureListingStore.scan scan}. A listing that fails discards
     * its own pages, but the nodes it produced -- and anything already fetched
     * beneath them -- stay cached: they were paid for and are still true, and a
     * retry re-indexes them unchanged.
     *
     * @param parentKey - The parent's hierarchical key, or
     *   {@linkcode AzureListingRootKey} for the accounts listing.
     * @param factory - Produces the underlying listing on a cache miss.
     */
    public listing<T extends AzureListingNode>(parentKey: string, factory: () => AsyncIterable<Page<T>>): CachedPagedListing<T> {
        const existing = this.listings.get(parentKey);
        if (existing) {
            return existing as unknown as CachedPagedListing<T>;
        }

        const created = new CachedPagedListing<T>(factory, page => {
            for (const item of page.items) {
                this.index(item);
            }
        });
        this.listings.set(parentKey, created as unknown as CachedPagedListing<AzureListingNode>);
        return created;
    }

    /** Whether a complete listing of the given parent's children is cached. */
    public isComplete(parentKey: string): boolean {
        return this.listings.get(parentKey)?.isComplete ?? false;
    }

    /** Record a node so it can be looked up and evicted by key. */
    public index(node: AzureListingNode): void {
        this.nodes.set(azureListingKey(node), node);
    }

    /** The cached node with the given hierarchical key, if any. */
    public get(key: string): AzureListingNode | undefined {
        return this.nodes.get(key);
    }

    /**
     * Every cached node beneath the given key, or every cached node when no key
     * is given. Yields nodes only -- it never triggers a fetch, so a scan sees
     * exactly what has already been paid for.
     */
    public *scan(parentKey: string = AzureListingRootKey): Iterable<AzureListingNode> {
        const prefix = childPrefix(parentKey).toLowerCase();
        for (const [key, node] of this.nodes) {
            if (key.toLowerCase().startsWith(prefix)) {
                yield node;
            }
        }
    }

    /** Evict a node, its cached descendants, and all of their listings. */
    public evict(key: string): void {
        this.nodes.delete(key);
        this.listings.delete(key);
        this.evictChildren(key);
    }

    /**
     * Evict everything cached beneath a node -- its children, their listings, and
     * the node's own listing of them -- while leaving the node itself in place.
     *
     * This is the invalidation for "this node is still true, but nothing under it
     * is", such as a sign-in that may have authorized tenants which were
     * invisible when the account was last listed. Evicting the node instead would
     * unindex it without removing it from its parent's cached listing, which
     * replays rather than re-indexing, so the node could never be looked up
     * again.
     */
    public evictDescendants(parentKey: string): void {
        this.listings.delete(parentKey);
        this.evictChildren(parentKey);
    }

    /**
     * Drop only the cached listing of a parent's children, keeping the children
     * themselves and everything beneath them.
     *
     * This is the narrow invalidation for "the *set* may have changed, but what
     * is under each surviving member has not" -- re-listing accounts after a
     * sign-in, for example, must not discard the tenants and subscriptions
     * already fetched for the accounts that were already there.
     */
    public evictListing(parentKey: string): void {
        this.listings.delete(parentKey);
    }

    /** Drop everything. */
    public clear(): void {
        this.nodes.clear();
        this.listings.clear();
    }

    /** Evict everything beneath `parentKey`, leaving `parentKey` itself in place. */
    private evictChildren(parentKey: string): void {
        const prefix = childPrefix(parentKey).toLowerCase();
        for (const [key] of this.nodes) {
            if (key.toLowerCase().startsWith(prefix)) {
                this.nodes.delete(key);
            }
        }
        for (const [key] of this.listings) {
            if (key.toLowerCase().startsWith(prefix)) {
                this.listings.delete(key);
            }
        }
    }
}
