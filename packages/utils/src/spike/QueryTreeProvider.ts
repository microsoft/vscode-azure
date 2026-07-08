/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SPIKE -- proof of concept only. Not exported from the package entry point and
 * not wired into any tree. Demonstrates how a `@tanstack/query-core`-backed tree
 * could look. See {@linkcode QueryTree}.
 *
 * @module
 */

/**
 * A single page of paginated children, as returned by
 * {@linkcode QueryTreeProvider.listPage}.
 *
 * @typeParam T - The node type produced by the provider.
 */
export interface PageResult<T> {
    /** The items in this page. */
    readonly items: readonly T[];
    /**
     * The `pageParam` to pass when requesting the next page, or `undefined`
     * when this is the last page. Maps directly onto query-core's
     * `getNextPageParam`.
     */
    readonly nextPageParam: number | undefined;
}

/**
 * SPIKE provider interface -- the query-core analogue of the production
 * `DataProvider`. Provider dispatch by {@linkcode canHandle} is preserved
 * (query-core has no notion of "which provider owns this resource"); everything
 * else -- caching, staleness, dedup, cancellation, pagination -- is delegated to
 * the {@linkcode QueryTree}'s `QueryClient`.
 *
 * The key differences from the production `DataProvider`:
 * - {@linkcode listChildren} receives an {@linkcode AbortSignal} so an in-flight
 *   fetch can be truly cancelled (not just discarded) when its subtree is
 *   collapsed or invalidated.
 * - {@linkcode enrich} returns *derived data* rather than mutating the node in
 *   place -- enrichment becomes its own dependent query.
 *
 * @typeParam T - The node type this provider operates on.
 */
export interface QueryTreeProvider<T> {
    /**
     * Test whether this provider handles the given node. Also a type guard that
     * narrows `unknown` to {@linkcode T}.
     */
    canHandle(node: unknown): node is T;

    /**
     * List the children of {@linkcode node}, or the root-level nodes when called
     * with `undefined` (root providers only).
     *
     * @param node - The parent node, or `undefined` for the root level.
     * @param signal - Aborted by query-core when the query is cancelled or its
     *   subtree is invalidated while the fetch is still in flight.
     */
    listChildren(node: T | undefined, signal: AbortSignal): Promise<readonly T[]>;

    /** Whether this provider can produce root-level nodes (called with `undefined`). */
    readonly isRoot?: boolean;

    /**
     * Compute derived data for {@linkcode node} without mutating it. Backed by a
     * dependent `['enrich', key]` query so it has its own cache entry, staleness,
     * dedup, and cancellation independent of the node's children.
     *
     * @param node - The node to enrich.
     * @param signal - Aborted when the enrichment query is cancelled.
     */
    enrich?(node: T, signal: AbortSignal): Promise<unknown>;

    /**
     * Fetch a single page of children for {@linkcode node}. When present, the
     * {@linkcode QueryTree} can drive an infinite ("Load More") query for this
     * node via {@linkcode QueryTree.paginate}.
     *
     * @param node - The parent node whose children are paginated.
     * @param pageParam - The cursor for the page to fetch (starts at `0`).
     * @param signal - Aborted when the page fetch is cancelled.
     */
    listPage?(node: T, pageParam: number, signal: AbortSignal): Promise<PageResult<T>>;
}
