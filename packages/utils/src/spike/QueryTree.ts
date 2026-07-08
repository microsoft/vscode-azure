/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SPIKE -- proof of concept only. Not exported from the package entry point and
 * not wired into any production tree. Explores whether `@tanstack/query-core`
 * can back an Azure-style lazy tree and unlock capabilities the production
 * `DataItemTree` lacks today.
 *
 * The load-bearing insight: **encode the tree path into the query key**. A
 * node's children live under `['children', ...pathToNode]`, so a *subtree*
 * invalidation is just a query-key *prefix* match -- query-core evicts the node
 * and every descendant for free, with no `NodeMap` walk, parent pointers, or
 * generation guards. Enrichment stops being in-place mutation and becomes a
 * dependent `['enrich', key]` query with its own staleness and cancellation.
 *
 * Capabilities demonstrated (see the accompanying tests):
 * 1. Provider dispatch preserved (`canHandle`).
 * 2. Subtree invalidation via key prefix.
 * 3. Self-only (exact) invalidation that keeps descendants cached.
 * 4. Enrichment as a dependent query.
 * 5. True request cancellation via `AbortSignal`.
 * 6. Pagination via an `InfiniteQueryObserver` (Load More).
 * 7. A change subscription a `TreeDataProvider` adapter could refresh from.
 *
 * `QueryTreeParity.test.ts` additionally reproduces the three trickiest
 * `DataItemTree` behaviors on this backing, to show what query-core dissolves:
 * - **Tier 1** the pagination "generation guard" (a page resolving after its
 *   subtree was invalidated must not land): here it is *structural* -- the page
 *   belongs to a keyed query that `cancel`/`invalidate` aborts, so there is no
 *   generation counter at all.
 * - **Tier 2** selector-driven invalidate/remove and root reconciliation:
 *   survivors' subtrees are kept for free because each node is an independent
 *   cache entry.
 * - **Tier 3** enrichment cancel-on-removal (no spurious change event after a
 *   node is removed mid-enrichment): removing the node removes its enrich query,
 *   so the late result is dropped.
 *
 * Intentionally OUT of scope for this spike: persistence. When added, it must
 * persist to the filesystem (via `vscode.workspace.fs`), not `globalState`.
 *
 * @module
 */

import {
    InfiniteQueryObserver,
    QueryClient,
    type InfiniteData,
    type QueryCacheNotifyEvent,
    type QueryKey,
} from '@tanstack/query-core';
import './queryCoreGlobals';
import type { PageResult, QueryTreeProvider } from './QueryTreeProvider';

/** A disposable handle, structurally compatible with `vscode.Disposable`. */
export interface QueryTreeDisposable {
    dispose(): void;
}

/**
 * A verdict predicate over a single node, the query-core analogue of the
 * production `Selector`. Returns:
 * - `'subtree'` -- invalidate/remove the node *and* its descendants;
 * - `'self'` -- act on the node's own enrichment only, keep descendants cached;
 * - `undefined` -- no match.
 *
 * Unlike the production selector, this runs over a flat resource index rather
 * than a walked node graph; "apex" minimization (a match under a matched
 * ancestor does not act twice) is computed by path-prefix math instead of
 * parent-pointer chasing.
 *
 * @typeParam T - The node type stored in the tree.
 */
export type TreeSelector<T> = (node: T) => 'self' | 'subtree' | undefined;

/**
 * Configuration for a {@linkcode QueryTree}.
 *
 * @typeParam T - The node type stored in the tree.
 */
export interface QueryTreeOptions<T> {
    /** Extract a unique, stable string key for a node. */
    readonly getKey: (node: T) => string;
    /**
     * Return the chain of keys from the root down to {@linkcode node}, inclusive
     * -- i.e. the node's path. This is what makes subtree invalidation a prefix
     * match: a child's path is its parent's path plus the child's own key, so
     * the child's children-query key is prefixed by the parent's.
     *
     * For real Azure nodes whose ids are hierarchical URIs, this is derivable
     * from the id alone; the spike takes it as a callback to stay decoupled.
     */
    readonly getPath: (node: T) => readonly string[];
    /** Time (ms) a fetched result stays fresh before it is considered stale. Default `60_000`. */
    readonly staleTime?: number;
    /**
     * Time (ms) an *unobserved* query is kept before garbage collection. Backs
     * the "bounded memory on huge trees" capability -- collapsed subtrees are
     * evicted automatically. Default `5 * 60_000` (query-core's default).
     */
    readonly gcTime?: number;
}

/**
 * A "Load More" handle over a node's paginated children, backed by a query-core
 * {@linkcode InfiniteQueryObserver}. Returned by {@linkcode QueryTree.paginate}.
 *
 * The first {@linkcode loadMore} loads page 0; each subsequent call loads the
 * next page. A production `TreeDataProvider` adapter would additionally
 * `subscribe` to the observer so the query stays "active" (participating in
 * refetch/gc); the spike keeps it fetch-driven for deterministic behavior.
 *
 * @typeParam T - The node type being paginated.
 */
export class TreePager<T> implements QueryTreeDisposable {
    /** @internal Constructed by {@linkcode QueryTree.paginate}. */
    public constructor(
        private readonly observer: InfiniteQueryObserver<PageResult<T>, Error, InfiniteData<PageResult<T>, number>, QueryKey, number>,
    ) { }

    /**
     * Load the next page (page 0 on the first call). Resolves once the page has
     * been fetched and merged into {@linkcode items}.
     */
    public async loadMore(): Promise<void> {
        await this.observer.fetchNextPage();
    }

    /** All items loaded so far, flattened across pages in order. */
    public get items(): readonly T[] {
        const data = this.observer.getCurrentResult().data;
        return data ? data.pages.flatMap(page => page.items) : [];
    }

    /** Whether another page is available to load. */
    public get hasMore(): boolean {
        return this.observer.getCurrentResult().hasNextPage;
    }

    public dispose(): void {
        this.observer.destroy();
    }
}

const CHILDREN = 'children';
const ENRICH = 'enrich';
const PAGES = 'pages';

/**
 * SPIKE: a lazily-loaded resource tree backed by a `@tanstack/query-core`
 * {@linkcode QueryClient}. See the module doc for the design rationale and the
 * list of demonstrated capabilities.
 *
 * @typeParam T - The node type stored in the tree.
 */
export class QueryTree<T> implements QueryTreeDisposable {
    private readonly client: QueryClient;
    private readonly providers: QueryTreeProvider<T>[] = [];

    /**
     * A thin key -> node index, populated as children/roots are fetched. Needed
     * because query-core caches *children lists*, not individual nodes: there is
     * no query that holds "the node itself", so selector-based targeting
     * ({@linkcode invalidateWhere} / {@linkcode removeWhere}) and {@linkcode get}
     * need somewhere to look nodes up. This is the one bit of `NodeMap`-style
     * bookkeeping that survives -- but it is a flat map with no tree structure,
     * no parent pointers, and no staleness.
     */
    private readonly index = new Map<string, T>();

    public constructor(private readonly options: QueryTreeOptions<T>) {
        this.client = new QueryClient({
            defaultOptions: {
                queries: {
                    staleTime: options.staleTime ?? 60_000,
                    gcTime: options.gcTime ?? 5 * 60_000,
                    // The spike asserts fetch counts deterministically; a real
                    // integration would enable retry with backoff here.
                    retry: false,
                },
            },
        });
    }

    /**
     * Register a provider. Registration order matters: {@linkcode findProvider}
     * returns the first provider whose {@linkcode QueryTreeProvider.canHandle}
     * matches, so more-specific providers must be registered first.
     *
     * @returns A disposable that unregisters the provider.
     */
    public registerProvider(provider: QueryTreeProvider<T>): QueryTreeDisposable {
        this.providers.push(provider);
        return {
            dispose: () => {
                const idx = this.providers.indexOf(provider);
                if (idx !== -1) {
                    this.providers.splice(idx, 1);
                }
            },
        };
    }

    /**
     * Get the children of {@linkcode node}, or the root-level nodes when called
     * with `undefined`. Results are cached and deduped by query-core: concurrent
     * calls share one fetch, and repeat calls within `staleTime` hit the cache.
     */
    public getChildren(node?: T): Promise<readonly T[]> {
        return this.client.fetchQuery({
            queryKey: this.childrenKey(node),
            queryFn: ({ signal }) => this.fetchChildren(node, signal),
        });
    }

    /**
     * Get the enrichment (derived data) for {@linkcode node} via its dependent
     * `['enrich', key]` query. Cached, deduped, and cancellable independently of
     * the node's children. Resolves to `undefined` when no provider enriches it.
     */
    public getEnrichment<E = unknown>(node: T): Promise<E | undefined> {
        const provider = this.findProvider(node);
        if (!provider?.enrich) {
            return Promise.resolve(undefined);
        }
        const enrich = provider.enrich.bind(provider);
        return this.client.fetchQuery({
            queryKey: [ENRICH, this.options.getKey(node)],
            queryFn: ({ signal }) => enrich(node, signal) as Promise<E>,
        });
    }

    /**
     * Invalidate {@linkcode node} and its entire subtree by prefix-matching the
     * children-query key. On next access the node and every descendant re-fetch.
     * Passing `undefined` invalidates the whole tree (the `['children']` prefix).
     *
     * In-flight fetches within the subtree are **cancelled** first (their
     * `AbortSignal` fires and query-core reverts them), so a page or child list
     * that resolves after the invalidation cannot land in the cache. This is the
     * structural replacement for `DataItemTree`'s generation counter: there is no
     * per-node generation to bump because the in-flight work is aborted outright.
     *
     * This is the payoff of path-encoded keys: no tree walk, no descendant
     * bookkeeping -- query-core matches the prefix for us.
     */
    public async invalidateSubtree(node?: T): Promise<void> {
        // Cancel in-flight subtree work first so a late page/list is discarded,
        // then mark stale so the next access re-fetches. Covers both plain
        // 'children' and paginated 'pages' queries.
        await this.cancel(node);
        await Promise.all([
            this.client.invalidateQueries({ queryKey: this.childrenKey(node) }),
            this.client.invalidateQueries({ queryKey: this.pagesKey(node) }),
        ]);
    }

    /**
     * Invalidate only {@linkcode node}'s own enrichment (its label/derived data),
     * leaving its cached children untouched -- the "self" counterpart to
     * {@linkcode invalidateSubtree}. Uses an *exact* match on the enrich key.
     */
    public invalidateSelf(node: T): Promise<void> {
        return this.client.invalidateQueries({ queryKey: [ENRICH, this.options.getKey(node)], exact: true });
    }

    /**
     * Cancel any in-flight children fetch for {@linkcode node} (or the whole tree
     * when `undefined`). query-core aborts the `AbortSignal` handed to the
     * provider, so a well-behaved provider stops its network request rather than
     * letting it run to completion.
     */
    public cancel(node?: T): Promise<void> {
        return Promise.all([
            this.client.cancelQueries({ queryKey: this.childrenKey(node) }),
            this.client.cancelQueries({ queryKey: this.pagesKey(node) }),
        ]).then(() => undefined);
    }

    /**
     * Look up a node by key from the resource index, if it has been fetched.
     * The query-core analogue of `DataItemTree.get`.
     */
    public get(key: string): T | undefined {
        return this.index.get(key);
    }

    /**
     * Remove {@linkcode node} and its whole subtree from the cache entirely
     * (children, pages, and enrichment queries), and prune the resource index --
     * the query-core analogue of `DataItemTree.remove`. Passing `undefined`
     * clears the entire tree.
     *
     * Because a removed node's enrichment query is removed too, an enrichment
     * still in flight is cancelled and its late result dropped -- the structural
     * replacement for the production "skip invalidation if the node was removed
     * while enrichment was in flight" guard.
     */
    public remove(node?: T): Promise<void> {
        if (node === undefined) {
            this.index.clear();
            this.client.getQueryCache().clear();
            return Promise.resolve();
        }
        const affected = this.subtreeMembers(node);
        this.client.removeQueries({ queryKey: this.childrenKey(node) });
        this.client.removeQueries({ queryKey: this.pagesKey(node) });
        for (const member of affected) {
            this.client.removeQueries({ queryKey: [ENRICH, this.options.getKey(member)], exact: true });
            this.index.delete(this.options.getKey(member));
        }
        return Promise.resolve();
    }

    /**
     * Invalidate every node matched by {@linkcode selector}. A `'subtree'`
     * verdict invalidates the node and its descendants' children/pages; a
     * `'self'` verdict invalidates only the node's enrichment. Redundant subtree
     * matches nested under a matched apex are collapsed -- the query-core
     * analogue of `DataItemTree.invalidate(selector)`, with apex minimization
     * done by path-prefix math over the flat index instead of a node-graph DFS.
     *
     * Note a deliberate refinement over the production tree: a subtree
     * invalidation here does *not* reset descendants' enrichment (enrichment is
     * an independent query), so enrichment is refreshed only by a `'self'`
     * verdict. This is strictly finer-grained than the production coupling.
     */
    public async invalidateWhere(selector: TreeSelector<T>): Promise<void> {
        const { subtreeApexes, selfNodes } = this.classify(selector);
        await Promise.all([
            ...subtreeApexes.map(node => this.invalidateSubtree(node)),
            ...selfNodes.map(node => this.invalidateSelf(node)),
        ]);
    }

    /**
     * Remove every node matched by {@linkcode selector} -- any verdict (`'self'`
     * or `'subtree'`) means "remove this node's subtree" -- collapsing matches
     * nested under a matched ancestor. The query-core analogue of
     * `DataItemTree.remove(selector)`.
     */
    public async removeWhere(selector: TreeSelector<T>): Promise<void> {
        const matched = [...this.index.values()].filter(node => selector(node) !== undefined);
        const { apexes } = this.classifyNodes(matched);
        await Promise.all(apexes.map(node => this.remove(node)));
    }

    /**
     * Reconcile the root level without wiping the tree: invalidate *only* the
     * root listing (an exact match on the `['children']` key) so the next access
     * re-lists the roots, while every descendant query survives untouched.
     *
     * This is the compelling contrast with `DataItemTree`, which preserves
     * survivors' subtrees by carefully keeping the same `TreeNode` objects across
     * a re-list. Here survival is simply the default: each descendant is an
     * independent cache entry, so re-listing the roots cannot disturb them.
     */
    public reconcileRoots(): Promise<void> {
        return this.client.invalidateQueries({ queryKey: [CHILDREN], exact: true });
    }

    /**
     * Evict the subtrees of roots that are no longer present (the "departed
     * roots" half of reconciliation), identified by their root key. Any cached
     * node whose path does not start with one of {@linkcode survivingRootKeys}
     * is removed.
     */
    public async evictSubtreesExcept(survivingRootKeys: ReadonlySet<string>): Promise<void> {
        const departed = [...this.index.values()].filter(node =>
            !survivingRootKeys.has(this.options.getPath(node)[0]));
        // Group by top-most departed ancestor so each subtree is removed once.
        const { apexes } = this.classifyNodes(departed);
        await Promise.all(apexes.map(node => this.remove(node)));
    }

    public paginate(node: T): TreePager<T> {
        const provider = this.findProvider(node);
        if (!provider?.listPage) {
            throw new Error(`No paginating provider for node: ${this.options.getKey(node)}`);
        }
        const listPage = provider.listPage.bind(provider);
        const observer = new InfiniteQueryObserver<PageResult<T>, Error, InfiniteData<PageResult<T>, number>, QueryKey, number>(this.client, {
            queryKey: [PAGES, ...this.options.getPath(node)],
            queryFn: ({ pageParam, signal }) => listPage(node, pageParam, signal),
            initialPageParam: 0,
            getNextPageParam: lastPage => lastPage.nextPageParam,
        });
        return new TreePager(observer);
    }

    /**
     * Subscribe to cache changes. A `TreeDataProvider` adapter would translate
     * these into `onDidChangeTreeData` fires. The listener receives the raw
     * query-core event so it can decide how narrowly to refresh.
     *
     * @returns A disposable that removes the subscription.
     */
    public onDidChange(listener: (event: QueryCacheNotifyEvent) => void): QueryTreeDisposable {
        const unsubscribe = this.client.getQueryCache().subscribe(listener);
        return { dispose: () => { unsubscribe(); } };
    }

    /** The underlying client, exposed for inspection/experimentation in the spike. */
    public getClient(): QueryClient {
        return this.client;
    }

    public dispose(): void {
        this.index.clear();
        this.client.getQueryCache().clear();
        this.client.clear();
    }

    // -- internals ---------------------------------------------------------

    /** The children-query key for a node, or the root key when `undefined`. */
    private childrenKey(node?: T): QueryKey {
        return node === undefined ? [CHILDREN] : [CHILDREN, ...this.options.getPath(node)];
    }

    /** The pages ('Load More') query key for a node, or the root pages key when `undefined`. */
    private pagesKey(node?: T): QueryKey {
        return node === undefined ? [PAGES] : [PAGES, ...this.options.getPath(node)];
    }

    /** Whether {@linkcode prefix} is a prefix of (or equal to) {@linkcode path}. */
    private isPrefixOrEqual(prefix: readonly string[], path: readonly string[]): boolean {
        return prefix.length <= path.length && prefix.every((seg, i) => path[i] === seg);
    }

    /** Whether {@linkcode prefix} is a *strict* prefix of {@linkcode path} (an ancestor). */
    private isStrictPrefix(prefix: readonly string[], path: readonly string[]): boolean {
        return prefix.length < path.length && this.isPrefixOrEqual(prefix, path);
    }

    /** All indexed nodes within {@linkcode node}'s subtree (including the node itself). */
    private subtreeMembers(node: T): T[] {
        const base = this.options.getPath(node);
        return [...this.index.values()].filter(candidate => this.isPrefixOrEqual(base, this.options.getPath(candidate)));
    }

    /**
     * Run {@linkcode selector} over the whole index and split matches into
     * minimized `'subtree'` apexes (nodes with no matched-subtree ancestor) and
     * the raw set of `'self'` verdict nodes (kept as-is, since enrichment is an
     * independent query and never covered by a subtree invalidation).
     */
    private classify(selector: TreeSelector<T>): { subtreeApexes: T[]; selfNodes: T[] } {
        const subtree: T[] = [];
        const selfNodes: T[] = [];
        for (const node of this.index.values()) {
            const verdict = selector(node);
            if (verdict === 'subtree') {
                subtree.push(node);
            } else if (verdict === 'self') {
                selfNodes.push(node);
            }
        }
        return { subtreeApexes: this.classifyNodes(subtree).apexes, selfNodes };
    }

    /** Reduce a node set to its apexes: drop any node that has an ancestor in the set. */
    private classifyNodes(nodes: readonly T[]): { apexes: T[] } {
        const paths = nodes.map(node => ({ node, path: this.options.getPath(node) }));
        const apexes = paths
            .filter(({ path }) => !paths.some(other => this.isStrictPrefix(other.path, path)))
            .map(({ node }) => node);
        return { apexes };
    }

    /** Find the first registered provider that handles {@linkcode node}. */
    private findProvider(node: T): QueryTreeProvider<T> | undefined {
        return this.providers.find(p => p.canHandle(node));
    }

    /** The children `queryFn`: dispatch to a provider (roots fan out to all root providers). */
    private async fetchChildren(node: T | undefined, signal: AbortSignal): Promise<readonly T[]> {
        let children: readonly T[];
        if (node === undefined) {
            const roots = this.providers.filter(p => p.isRoot);
            const results = await Promise.all(roots.map(p => p.listChildren(undefined, signal)));
            children = results.flat();
        } else {
            const provider = this.findProvider(node);
            children = provider ? await provider.listChildren(node, signal) : [];
        }
        for (const child of children) {
            this.index.set(this.options.getKey(child), child);
        }
        return children;
    }
}
