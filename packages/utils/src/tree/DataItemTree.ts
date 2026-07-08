/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QueryClient, type QueryKey } from '@tanstack/query-core';
import type { IActionExecutor } from '../base/IActionExecutor';
import { stringifyError } from '../base/stringifyError';
import { InflightMap } from '../data/InflightMap';
import { Limiter } from '../data/Limiter';
import { isAsyncIterable, type Page } from '../data/Page';
import type { Disposable } from '../vscode/Disposable';
import type { IVsCode } from '../vscode/IVsCode';
import type { DataProvider, DataProviderChangeEvent } from './DataProvider';
import { ProviderRegistry } from './ProviderRegistry';
import { Everything, isKeyMatch, Roots, subtreeOf, type KeyMatch, type MatchScope, type Selector, type Target } from './Selector';
import { TreeIndex } from './TreeIndex';

/** The query-key namespace under which a node's children list is cached. */
const CHILDREN = 'children';

/**
 * Per-node pagination state for a resource whose provider returned an
 * `AsyncIterable<Page>`. Held in a side map keyed by resource key.
 *
 * The pager *object identity* is the structural replacement for the old
 * per-node generation counter: an in-flight `loadOnePage` captures its pager and
 * discards the resolved page if `pagers.get(key)` is no longer that same object
 * (because an {@linkcode DataItemTree.invalidate}/{@linkcode DataItemTree.remove}
 * deleted or replaced it). There is no monotonic counter to bump.
 *
 * @internal
 */
interface Pager<T> {
    /** The in-progress async iterator; `undefined` once exhausted. */
    iterator: AsyncIterator<Page<T>> | undefined;
    /** Whether another page is available (mirrors the last page's `hasMore`). */
    hasMore: boolean;
    /** The node's path (root -> node, inclusive), captured so page appends survive eviction races. */
    readonly path: readonly string[];
}

/**
 * A per-node side table whose entries' lifetime is tied to a node's presence in
 * the tree index. Registered in {@linkcode DataItemTree}'s `nodeSideTables` so
 * that single-node teardown and full teardown drop every table in lockstep --
 * adding a new per-node table becomes a one-line registration that no eviction
 * call site can forget.
 *
 * @internal
 */
interface NodeSideTable {
    /** Drop the entry for a single node key (a no-op if absent). */
    evict(key: string): void;
    /** Drop all entries. */
    clear(): void;
}

/**
 * A lazily-loaded, cached tree of data items built up piecewise by
 * {@linkcode DataProvider}s.
 *
 * Each node's children are loaded on first access and cached until stale. The
 * tree is the single source of truth for the data layer -- the
 * `TreeDataProvider`s are view-only and read from it.
 *
 * ## Backing store
 *
 * Children lists, their staleness (TTL), and in-flight de-duplication are
 * delegated to a `@tanstack/query-core` {@linkcode QueryClient}: a node's
 * children live under the query key `['children', ...path]`, where `path` is the
 * chain of keys from a root down to the node. Because a child's path is its
 * parent's path plus the child's own key, a *subtree* eviction is a query-key
 * *prefix* removal -- query-core drops the node and every descendant with no
 * manual tree walk. Hierarchy that query-core does not model (the tree's keys
 * are opaque strings, not necessarily hierarchical) is recovered from a
 * {@linkcode TreeIndex} -- the pure, synchronous half that records each loaded
 * node's resource and path and answers the structural questions (direct
 * children, descendants, parent, apexes) this orchestrator composes with the
 * cache. This class owns the *policy* (fetch, evict, enrich, paginate, fire
 * events) and keeps the two halves consistent: every cached path corresponds to
 * an indexed node and vice versa.
 *
 * The public surface is deliberately *synchronous* where callers observe it
 * (`invalidate` / `remove` / `get` / `onDidChange`), so those paths use only
 * query-core's synchronous operations (`removeQueries` / `setQueryData` /
 * `getQueryCache().clear()`), never the promise-returning `invalidateQueries` /
 * `cancelQueries`.
 *
 * @typeParam T - The data item type stored in the tree.
 */
export class DataItemTree<T> extends ProviderRegistry<T, DataProvider<T>> implements Disposable {
    /**
     * Backing cache for children lists. A node's children (a `T[]`, even when
     * paginated -- pages are appended in place) live under `['children', ...path]`.
     */
    private readonly client: QueryClient;

    /**
     * The hierarchy half: key -> resource and key -> path, plus the prefix/apex
     * math. Kept consistent with {@linkcode client} by this class (every cached
     * path has an indexed node here and vice versa).
     */
    private readonly tree: TreeIndex<T>;

    /**
     * Per-resource enrichment promises, keyed by resource key. Stored when
     * {@linkcode enrichAll} kicks off background enrichment so that callers (e.g.
     * commands) can await completion via {@linkcode whenEnriched}.
     */
    private readonly enrichmentPromises = new Map<string, Promise<void>>();

    /**
     * Per-resource in-flight page-load promises. Prevents concurrent `next()`
     * calls on the same async iterator when `loadMore` / `loadAll` overlap.
     */
    private readonly loadsInFlight = new InflightMap<void>();

    /** Per-resource pagination state (present only for paginated nodes). */
    private readonly pagers = new Map<string, Pager<T>>();

    /**
     * The registry of per-node side tables kept consistent with the {@linkcode tree}
     * index. {@linkcode evictEntry} (single node) and {@linkcode clearNodeState}
     * (all nodes) iterate this list, so no teardown path can forget a table and
     * adding a new one is a single registration below.
     *
     * The query {@linkcode client cache} is deliberately *not* a member: it is
     * keyed by path (not node key) and torn down at subtree granularity -- one
     * prefix removal drops a node and all descendants -- so it does not fit the
     * per-key `evict(key)` contract. Full teardown handles it in
     * {@linkcode clearAllState}.
     */
    private readonly nodeSideTables: readonly NodeSideTable[];

    public readonly onDidChange = this.changeEmitter.event;

    /**
     * @param name - A short identifier for this tree instance (e.g.
     *   `'resources'`, `'activity'`). Stamped on every telemetry event as
     *   `properties.tree`.
     * @param executor - Action executor for wrapping provider calls in
     *   telemetry scopes. Every {@linkcode DataProvider.getChildren} and
     *   {@linkcode DataProvider.enrich} call runs inside
     *   {@linkcode IActionExecutor.callWithTelemetryAndErrorHandling}, which
     *   establishes an {@linkcode IActionContext} on the async call stack via
     *   `AsyncLocalStorage`. Pipeline policies (e.g. `CorrelationIdPolicy`) pick
     *   up this context automatically without any changes to provider or client
     *   signatures.
     * @param getKey - Extracts a unique string key from a resource.
     * @param ttl - Time-to-live in milliseconds for cached children.
     */
    public constructor(
        private readonly code: IVsCode,
        private readonly name: string,
        private readonly executor: IActionExecutor,
        private readonly getKey: (resource: T) => string,
        private readonly ttl: number,
    ) {
        super();
        this.tree = new TreeIndex<T>(getKey);
        this.nodeSideTables = [
            { evict: key => { this.tree.evict(key); }, clear: () => { this.tree.clear(); } },
            { evict: key => { this.pagers.delete(key); }, clear: () => { this.pagers.clear(); } },
            { evict: key => { this.enrichmentPromises.delete(key); }, clear: () => { this.enrichmentPromises.clear(); } },
        ];
        this.client = new QueryClient({
            defaultOptions: {
                queries: {
                    staleTime: ttl,
                    // Eviction is driven explicitly by invalidate/remove (and by
                    // per-fetch staleness), never by query-core's garbage
                    // collector -- otherwise the flat index/paths maps would drift
                    // out of sync with the cache. `Infinity` disables GC.
                    gcTime: Infinity,
                    // The tree rethrows provider errors to its caller; a real
                    // integration owns retry/backoff at the client layer.
                    retry: false,
                },
            },
        });
    }

    /**
     * Get children for the given resource, or the root-level resources when
     * called with `undefined` -- mirroring VSCode's
     * {@linkcode vscode.TreeDataProvider.getChildren TreeDataProvider.getChildren}.
     *
     * Results are lazily loaded and cached with TTL, and concurrent calls for
     * the same node share a single fetch.
     */
    public async getChildren(resource?: T): Promise<T[]> {
        if (resource === undefined) {
            return this.getRootChildren();
        }
        return this.getBranchChildren(resource);
    }

    private async getRootChildren(): Promise<T[]> {
        const rootProviders = this.getRootProviders();
        const children = await this.client.fetchQuery({
            queryKey: this.childrenKey([]),
            staleTime: this.rootTtl(rootProviders),
            queryFn: () => this.fetchRoots(rootProviders),
        });
        return [...children];
    }

    /** The children `queryFn` for the root level: fan out to all root providers. */
    private async fetchRoots(rootProviders: DataProvider<T>[]): Promise<T[]> {
        this.executor.output.debug(`[data] ${this.name} root fetch start (providers=${rootProviders.length})`);

        // Each root provider gets its own telemetry scope so that concurrent
        // calls don't overwrite shared mutable properties.
        const limiter = new Limiter<T[] | null | undefined>(5);
        const results = await Promise.all(
            rootProviders.map(p => limiter.queue(() => this.executor.callWithTelemetryAndErrorHandling<T[]>('tree.getRootChildren', (context) => {
                context.telemetry.isUserEvent = false;
                context.errorHandling.rethrow = true;
                context.telemetry.properties.tree = this.name;
                context.telemetry.properties.provider = p.constructor.name;
                return Promise.resolve(p.getChildren()) as Promise<T[]>;
            }))),
        );

        // Root providers always return plain arrays (pagination at the root level
        // is not supported).
        const resources = results.flatMap((result) => {
            if (!result) {
                return [];
            } else if (isAsyncIterable(result)) {
                throw new Error('Root providers must return plain arrays, not AsyncIterables');
            }
            return result;
        });

        // Reconcile the freshly-listed roots against the previously-indexed ones
        // by key: surviving roots keep their (independently cached) subtrees,
        // departed roots have their subtrees evicted. After invalidate(Everything)
        // the index is empty, so this degenerates to a full fresh fetch.
        this.reconcileChildren([], resources);
        this.enrichAll(resources);
        this.executor.output.debug(`[data] ${this.name} root fetch done (providers=${rootProviders.length} count=${resources.length})`);
        return resources;
    }

    /**
     * Determine the TTL (in milliseconds) to use for the root level. If any root
     * provider defines {@linkcode DataProvider.getTtl}, the smallest such value is
     * used; otherwise the tree's default TTL applies.
     */
    private rootTtl(rootProviders: DataProvider<T>[]): number {
        const ttls = rootProviders
            .filter(p => typeof p.getTtl === 'function')
            .map(p => p.getTtl!()); // eslint-disable-line @typescript-eslint/no-non-null-assertion -- filtered above
        return ttls.length > 0 ? Math.min(...ttls) : this.ttl;
    }

    private async getBranchChildren(resource: T): Promise<T[]> {
        const key = this.getKey(resource);
        const path = this.tree.pathOf(key);
        if (path === undefined) {
            throw new Error(`Resource not found in tree: ${key}`);
        }

        const provider = this.findProvider(resource);
        const children = await this.client.fetchQuery({
            queryKey: this.childrenKey(path),
            staleTime: provider?.getTtl?.(resource) ?? this.ttl,
            queryFn: () => this.fetchBranch(resource, path, provider),
        });
        return [...children];
    }

    /** The children `queryFn` for a branch node: dispatch to its provider. */
    private async fetchBranch(resource: T, path: readonly string[], provider: DataProvider<T> | undefined): Promise<T[]> {
        const key = this.getKey(resource);

        // A node re-fetching its children restarts pagination; drop any prior pager.
        this.pagers.delete(key);

        if (!provider) {
            this.reconcileChildren(path, []);
            this.executor.output.debug(`[data] ${this.name} branch fetch done key=${key} count=0 provider=<none>`);
            return [];
        }

        this.executor.output.debug(`[data] ${this.name} branch fetch start key=${key} provider=${provider.constructor.name}`);
        const result = await this.executor.callWithTelemetryAndErrorHandling('tree.getBranchChildren', (context) => {
            context.telemetry.isUserEvent = false;
            context.errorHandling.rethrow = true;
            // The data layer is a pure cache that rethrows; whoever consumes the
            // rejection (the view layer, or a programmatic caller like the Select
            // Subscriptions command) owns error display, so don't show a toast
            // here as well.
            context.errorHandling.suppress = 'display';
            context.telemetry.properties.tree = this.name;
            context.telemetry.properties.provider = provider.constructor.name;
            return provider.getChildren(resource);
        });

        let children: T[];
        if (!result) {
            children = [];
            this.reconcileChildren(path, children);
        } else if (isAsyncIterable(result)) {
            // Paged result: install a pager and pull the first page.
            const pager: Pager<T> = { iterator: result[Symbol.asyncIterator](), hasMore: true, path };
            this.pagers.set(key, pager);
            children = await this.pullFirstPage(resource, pager);
        } else {
            children = result;
            this.reconcileChildren(path, children);
            this.enrichAll(children);
        }

        this.executor.output.debug(`[data] ${this.name} branch fetch done key=${key} count=${children.length} provider=${provider.constructor.name}`);
        return children;
    }

    /**
     * Pull the first page for a freshly-installed pager, reconcile the node's
     * direct children against it, and enrich. Returns the first page's items,
     * which become the node's initial cached children list.
     */
    private async pullFirstPage(resource: T, pager: Pager<T>): Promise<T[]> {
        const key = this.getKey(resource);
        const next = await this.executor.callWithTelemetryAndErrorHandling('tree.loadMore', (context) => {
            context.telemetry.isUserEvent = false;
            context.errorHandling.rethrow = true;
            context.errorHandling.suppress = 'display';
            context.telemetry.properties.tree = this.name;
            return pager.iterator!.next(); // eslint-disable-line @typescript-eslint/no-non-null-assertion -- freshly created above
        });

        // If the pager was replaced/removed while the first page was in flight
        // (e.g. a concurrent invalidate), discard the page.
        if (this.pagers.get(key) !== pager) {
            return [...(this.client.getQueryData<T[]>(this.childrenKey(pager.path)) ?? [])];
        }

        const items = next!.done ? [] : next!.value.items; // eslint-disable-line @typescript-eslint/no-non-null-assertion -- rethrows on error
        pager.hasMore = next!.done ? false : next!.value.hasMore; // eslint-disable-line @typescript-eslint/no-non-null-assertion -- rethrows on error
        if (!pager.hasMore) {
            pager.iterator = undefined;
        }
        this.reconcileChildren(pager.path, items);
        this.enrichAll(items);
        return items;
    }

    /**
     * For each resource, find the provider that handles it and call
     * {@linkcode DataProvider.enrich enrich} if present. Enrichment runs in the
     * background -- each resolved call fires {@linkcode onDidChange} for that
     * resource. The per-resource promise is stored so callers can await
     * completion via {@linkcode whenEnriched}.
     */
    private enrichAll(resources: T[]): void {
        const limiter = new Limiter<boolean | undefined>(5);
        for (const resource of resources) {
            const provider = this.findProvider(resource);
            if (provider?.enrich) {
                const key = this.getKey(resource);
                this.executor.output.debug(`[data] ${this.name} enrich start key=${key} provider=${provider.constructor.name}`);
                const promise = limiter.queue(() => this.executor
                    .callWithTelemetryAndErrorHandling('tree.enrich', (context) => {
                        context.telemetry.isUserEvent = false;
                        context.telemetry.suppress = 'onSuccess';
                        context.errorHandling.rethrow = true;
                        context.telemetry.properties.tree = this.name;
                        context.telemetry.properties.provider = provider.constructor.name;
                        return provider.enrich!(resource); // eslint-disable-line @typescript-eslint/no-non-null-assertion -- asserted non-null above
                    }))
                    .then((includeChildren) => {
                        this.enrichmentPromises.delete(key);
                        this.executor.output.debug(`[data] ${this.name} enrich done key=${key} includeChildren=${includeChildren}`);
                        // Guard: if the node was removed (e.g. via remove) while
                        // enrichment was in flight, skip the invalidation to avoid
                        // spurious change events for items no longer in the tree.
                        if (this.tree.has(key)) {
                            // `includeChildren` is `undefined` only if enrichment
                            // was suppressed/errored; default to re-fetching
                            // children, matching the historical default behavior.
                            this.invalidateEntries([resource], (includeChildren ?? true) ? 'subtree' : 'self');
                        }
                    })
                    .catch((error: unknown) => {
                        const message = stringifyError(error);
                        this.executor.output.warn(this.code.l10n.t('[data] {0} enrich failed key={1} provider={2} message={3}', this.name, key, provider.constructor.name, message));
                        throw error;
                    });
                this.enrichmentPromises.set(key, promise);
                // Attach a rejection handler so background rejections are not unhandled.
                void promise.catch(() => { /* noop */ });
            }
        }
    }

    /**
     * Returns a promise that resolves once enrichment has completed for the given
     * resource.
     *
     * If no enrichment provider matched the resource (or enrichment has already
     * finished), the promise resolves immediately. If enrichment fails, the
     * promise rejects with the error but does not retry automatically.
     *
     * The optional type parameter `TEnriched` lets callers narrow the return type
     * to a branded subtype whose once-optional enrichment properties are
     * guaranteed to be populated:
     *
     * ```ts
     * const registry = await cache.whenEnriched<EnrichedAcrRegistry>(resource);
     * registry.loginServer; // string (not string | undefined)
     * ```
     *
     * If displaying a loading toast, it is suggested to use `{@linkcode withDelayedProgress}`
     * instead of `vscode.window.withProgress` directly, to avoid flashing the
     * toast for fast operations.
     */
    public async whenEnriched<TEnriched extends T = T>(resource: T): Promise<TEnriched> {
        await this.enrichmentPromises.get(this.getKey(resource));
        return resource as TEnriched;
    }

    /**
     * Returns `true` when the provider that produced children for the given
     * resource has more pages available (i.e. the async iterator has not yet been
     * exhausted).
     */
    public hasMore(resource?: T): boolean {
        if (resource === undefined) {
            return false; // Root-level pagination not supported.
        }
        return this.pagers.get(this.getKey(resource))?.hasMore ?? false;
    }

    /**
     * Pull the next page from the stored async iterator for the given resource.
     * The new children are appended to the cache and enriched. Fires
     * {@linkcode onDidChange} so the view refreshes automatically; callers should
     * use {@linkcode getChildren} to read the updated list.
     *
     * @throws if {@linkcode getChildren} has not been called for this resource yet.
     */
    public async loadMore(resource: T): Promise<void> {
        const key = this.getKey(resource);
        if (this.client.getQueryData<T[]>(this.childrenKey(this.tree.pathOf(key) ?? [key])) === undefined) {
            throw new Error(`Cannot loadMore before getChildren has been called for: ${key}`);
        }
        await this.loadOnePage(resource);
        this.changeEmitter.fire(resource);
    }

    /**
     * Pulls all remaining pages for the given resource until the iterator is
     * exhausted. Fires {@linkcode onDidChange} after all pages are loaded so the
     * view refreshes only once.
     *
     * If children have not been loaded yet (i.e. {@linkcode getChildren} was never
     * called for this resource), the initial load is triggered first.
     */
    public async loadAll(resource: T): Promise<void> {
        const didLoad = await this.executor.callWithTelemetryAndErrorHandling('tree.loadAll', async (context) => {
            context.telemetry.isUserEvent = false;
            context.errorHandling.rethrow = true;
            context.errorHandling.suppress = 'display';
            context.telemetry.properties.tree = this.name;

            const key = this.getKey(resource);
            let loaded = false;

            // Ensure children are initialized (first page pulled) before
            // exhausting the remaining pages.
            if (this.client.getQueryData<T[]>(this.childrenKey(this.tree.pathOf(key) ?? [key])) === undefined) {
                await this.getChildren(resource);
                loaded = true;
            }

            while (this.hasMore(resource)) {
                await this.loadOnePage(resource);
                loaded = true;
            }
            return loaded;
        });

        if (didLoad) {
            this.changeEmitter.fire(resource);
        }
    }

    private async loadOnePage(resource: T): Promise<void> {
        const key = this.getKey(resource);
        await this.loadsInFlight.getOrRun(key, async () => {
            const pager = this.pagers.get(key);
            if (!pager?.iterator) {
                return;
            }

            const next = await this.executor.callWithTelemetryAndErrorHandling('tree.loadMore', (context) => {
                context.telemetry.isUserEvent = false;
                context.errorHandling.rethrow = true;
                context.errorHandling.suppress = 'display';
                context.telemetry.properties.tree = this.name;
                return pager.iterator!.next(); // eslint-disable-line @typescript-eslint/no-non-null-assertion -- asserted non-null above
            });

            // The node was removed (remove) or its subtree wiped (invalidate)
            // while this page was in flight -- the pager was deleted/replaced, so
            // discard the page. This is the structural replacement for the old
            // generation counter.
            if (this.pagers.get(key) !== pager || !this.tree.has(key)) {
                return;
            }

            if (next!.done) { // eslint-disable-line @typescript-eslint/no-non-null-assertion -- rethrows on error
                pager.iterator = undefined;
                pager.hasMore = false;
            } else {
                const items = next!.value.items; // eslint-disable-line @typescript-eslint/no-non-null-assertion -- rethrows on error
                this.client.setQueryData<T[]>(this.childrenKey(pager.path), old => [...(old ?? []), ...items]);
                this.tree.indexChildren(pager.path, items);
                this.enrichAll(items);
                pager.hasMore = next!.value.hasMore; // eslint-disable-line @typescript-eslint/no-non-null-assertion -- rethrows on error
                if (!pager.hasMore) {
                    pager.iterator = undefined;
                }
            }
        });
    }

    /**
     * Get a resource by key from the tree, if it has been loaded.
     */
    public get(key: string): T | undefined {
        return this.tree.get(key);
    }

    /**
     * Test-only snapshot of the internal stores, used to assert the tree's
     * cross-store consistency invariants (see `DataItemTree.consistency.test.ts`).
     * Not part of the supported public API and must not be used in product code.
     *
     * @returns The indexed nodes (key -> path), every cached children path (the
     *   `['children', ...path]` query keys with the `'children'` prefix stripped),
     *   and the live pager / enrichment side-table keys.
     * @internal
     */
    public snapshotState(): {
        readonly indexed: ReadonlyMap<string, readonly string[]>;
        readonly cachedPaths: readonly (readonly string[])[];
        readonly pagerKeys: readonly string[];
        readonly enrichmentKeys: readonly string[];
    } {
        const indexed = new Map<string, readonly string[]>();
        for (const [key] of this.tree.entries()) {
            indexed.set(key, this.tree.pathOf(key)!); // eslint-disable-line @typescript-eslint/no-non-null-assertion -- key came from entries(), so it is indexed
        }
        const cachedPaths = this.client.getQueryCache().getAll()
            .map(query => query.queryKey)
            .filter((key): key is readonly unknown[] => Array.isArray(key) && key[0] === CHILDREN)
            .map(key => key.slice(1) as string[]);
        return {
            indexed,
            cachedPaths,
            pagerKeys: [...this.pagers.keys()],
            enrichmentKeys: [...this.enrichmentPromises.keys()],
        };
    }

    /**
     * Invalidate part of the cache, marking matched nodes stale so they are
     * re-fetched on next access, and firing {@linkcode onDidChange} so the view
     * re-renders. Accepts the full {@linkcode Target} surface:
     *
     * - a bare resource / key / array -> matched by key, treated as `'subtree'`
     *   (the node and its descendants are evicted and re-fetched);
     * - {@linkcode selfOnly}(...) -> matched by key, `'self'` (re-render the
     *   node's label only, keep its cached children);
     * - a {@linkcode Selector} -> a verdict predicate evaluated over every loaded
     *   node (e.g. `bySubscription(id)`);
     * - {@linkcode Roots} -> reconciling root re-list (preserve surviving roots'
     *   subtrees);
     * - {@linkcode Everything} -> wipe the entire cache.
     *
     * The change event fires once per *apex* (a matched node with no matched
     * ancestor) after the whole traversal completes, so a single call produces the
     * minimal set of re-renders and is safe against re-entrancy.
     *
     * @param target - What to invalidate.
     */
    public invalidate(target: Target<T>): void {
        if (target === Everything) {
            this.invalidateAllImpl();
        } else if (target === Roots) {
            this.invalidateRootImpl();
        } else if (typeof target === 'function') {
            this.invalidateSelector(target as Selector<T>);
        } else {
            const { match, scope } = this.toKeyMatch(target);
            this.invalidateEntries(match, scope);
        }
    }

    /**
     * Remove matched nodes (and their subtrees) from the cache entirely, as
     * opposed to {@linkcode invalidate} which keeps the node and re-fetches. Each
     * matched node is evicted and spliced out of its parent's child list; for
     * non-root removals {@linkcode onDidChange} fires for the parent (so the view
     * re-renders without re-fetching siblings), and for root removals it fires
     * with `undefined` (full refresh). Matched apexes absorb their subtrees, and
     * parent fires are de-duplicated.
     *
     * Accepts a {@linkcode Selector}, a bare resource / key / array, or a
     * {@linkcode selfOnly} / {@linkcode subtreeOf} descriptor (both remove the
     * whole subtree -- `scope` is irrelevant to removal). The {@linkcode Roots}
     * and {@linkcode Everything} sentinels are **not** accepted.
     *
     * If nothing matches, this is a no-op.
     *
     * @param target - What to remove.
     */
    public remove(target: Target<T>): void {
        if (target === Everything || target === Roots) {
            throw new Error('remove() does not accept the Roots or Everything sentinels; use invalidate() instead.');
        }

        const matchedKeys = typeof target === 'function'
            ? this.collectMatches(target as Selector<T>)
            : [...this.toKeySet(this.toKeyMatch(target).match)].filter(key => this.tree.has(key));

        this.removeNodes(matchedKeys);
    }

    // -- target normalization ------------------------------------------------

    /** Normalize a resource / key / array input into a flat list of entries. */
    private toEntries(input: T | string | ReadonlyArray<T | string>): ReadonlyArray<T | string> {
        return Array.isArray(input) ? input as ReadonlyArray<T | string> : [input as T | string];
    }

    /**
     * Normalize a by-key target into a {@linkcode KeyMatch}: a {@linkcode selfOnly}
     * / {@linkcode subtreeOf} descriptor passes through unchanged, while a bare
     * resource / key / array is wrapped as {@linkcode subtreeOf}.
     */
    private toKeyMatch(target: KeyMatch<T> | T | string | ReadonlyArray<T | string>): KeyMatch<T> {
        return isKeyMatch<T>(target) ? target : subtreeOf(...this.toEntries(target));
    }

    /** Map resources/keys to a set of cache keys, honoring {@linkcode getKey}. */
    private toKeySet(input: T | string | ReadonlyArray<T | string>): Set<string> {
        return new Set(this.toEntries(input).map(entry => typeof entry === 'string' ? entry : this.getKey(entry)));
    }

    // -- key-based invalidation ---------------------------------------------

    /**
     * Key-based invalidation over a list of resource/key entries.
     *
     * For a `'subtree'` scope, a *loaded* node's cached subtree is wiped so it
     * re-fetches on next access. The change event is then fired so the view
     * re-renders. When the entry is a resource object the *passed* resource is
     * fired unconditionally -- even if the data layer has no node for it -- so a
     * view-layer node that exists independently of the data layer still refreshes.
     * When the entry is a bare key string and no node is loaded, there is no
     * resource to fire, so it is skipped.
     */
    private invalidateEntries(entries: ReadonlyArray<T | string>, scope: MatchScope): void {
        const fires: T[] = [];
        for (const entry of entries) {
            const isKey = typeof entry === 'string';
            const key = isKey ? entry : this.getKey(entry);
            const loaded = this.tree.has(key);
            if (loaded && scope === 'subtree') {
                this.wipeSubtreeKeepNode(key);
            }
            if (!isKey) {
                fires.push(entry);
            } else if (loaded) {
                fires.push(this.tree.get(key)!); // eslint-disable-line @typescript-eslint/no-non-null-assertion -- loaded checked above
            }
        }
        for (const resource of fires) {
            this.changeEmitter.fire(resource);
        }
    }

    /**
     * Depth-first invalidation driven by a {@linkcode Selector} verdict, over the
     * flat index. A `'subtree'` verdict wipes the node and its descendants; a
     * `'self'` verdict re-renders the label and keeps its children. Apex
     * minimization (a match nested under a matched-subtree ancestor does not fire
     * again) is computed by path-prefix math. Fires happen after the traversal for
     * re-entrancy safety.
     */
    private invalidateSelector(selector: Selector<T>): void {
        const subtreeKeys: string[] = [];
        const selfKeys: string[] = [];
        for (const [key, resource] of this.tree.entries()) {
            const scope = selector(resource);
            if (scope === 'subtree') {
                subtreeKeys.push(key);
            } else if (scope === 'self') {
                selfKeys.push(key);
            }
        }

        const subtreeApexes = this.tree.apexes(subtreeKeys);
        const subtreeApexSet = new Set(subtreeApexes);
        const fires: T[] = [];

        for (const key of subtreeApexes) {
            this.wipeSubtreeKeepNode(key);
            fires.push(this.tree.get(key)!); // eslint-disable-line @typescript-eslint/no-non-null-assertion -- from index
        }
        // A 'self' node nested under a wiped subtree apex is subsumed by that apex's fire.
        for (const key of selfKeys) {
            if (!this.tree.hasAncestorIn(key, subtreeApexSet)) {
                fires.push(this.tree.get(key)!); // eslint-disable-line @typescript-eslint/no-non-null-assertion -- from index
            }
        }
        for (const resource of fires) {
            this.changeEmitter.fire(resource);
        }
    }

    /**
     * Collect the matched apex keys for a selector-driven {@linkcode remove}: a
     * matched node's subtree is removed wholesale, so a match nested under another
     * match is dropped (a `'self'` vs `'subtree'` verdict is irrelevant to
     * removal -- any verdict means "remove this subtree").
     */
    private collectMatches(selector: Selector<T>): string[] {
        const matched: string[] = [];
        for (const [key, resource] of this.tree.entries()) {
            if (selector(resource) !== undefined) {
                matched.push(key);
            }
        }
        return this.tree.apexes(matched);
    }

    /**
     * Evict the given matched apex keys. Parent fires are de-duplicated; if any
     * root was removed, a single full-refresh (`undefined`) fire subsumes the rest.
     */
    private removeNodes(matchedKeys: string[]): void {
        if (matchedKeys.length === 0) {
            return;
        }
        const parentFires = new Set<T>();
        let fireRoot = false;
        for (const key of matchedKeys) {
            const parent = this.tree.parentResourceOf(key);
            this.spliceFromParentList(key);
            this.evictSubtree(key);
            if (parent === undefined) {
                fireRoot = true;
            } else {
                parentFires.add(parent);
            }
        }
        if (fireRoot) {
            // A full refresh re-renders every parent too, so skip the rest.
            this.changeEmitter.fire(undefined);
        } else {
            for (const parentResource of parentFires) {
                this.changeEmitter.fire(parentResource);
            }
        }
    }

    // -- subtree / cache mutation (synchronous) -----------------------------

    /**
     * Wipe a node's subtree while keeping the node itself: remove its children
     * query (a prefix removal that also drops descendants' children queries),
     * drop its pager, and evict every descendant from the flat index/paths maps
     * (clearing their enrichment promises too). The node stays a valid tree item;
     * its children re-fetch on next access.
     */
    private wipeSubtreeKeepNode(key: string): void {
        const path = this.tree.pathOf(key);
        if (path === undefined) {
            return;
        }
        this.client.removeQueries({ queryKey: this.childrenKey(path) });
        this.pagers.delete(key);
        for (const descendantKey of this.tree.descendantKeys(path)) {
            this.evictEntry(descendantKey);
        }
    }

    /**
     * Remove a node and its whole subtree from the flat maps, pagers, enrichment
     * promises, and the query cache. Does **not** fire or splice the node out of
     * its parent's cached list (callers handle those).
     */
    private evictSubtree(key: string): void {
        const path = this.tree.pathOf(key);
        if (path === undefined) {
            return;
        }
        this.client.removeQueries({ queryKey: this.childrenKey(path) });
        this.evictEntry(key);
        for (const descendantKey of this.tree.descendantKeys(path)) {
            this.evictEntry(descendantKey);
        }
    }

    /**
     * The single choke point for single-node teardown: drop the given key from
     * every registered {@linkcode nodeSideTables} table (index, pagers,
     * enrichment promises). Does **not** touch the query cache -- callers remove
     * cached children at subtree granularity via a prefix removal.
     */
    private evictEntry(key: string): void {
        for (const table of this.nodeSideTables) {
            table.evict(key);
        }
    }

    /** Clear every registered per-node {@linkcode nodeSideTables side table}. */
    private clearNodeState(): void {
        for (const table of this.nodeSideTables) {
            table.clear();
        }
    }

    /**
     * The single choke point for full teardown: clear the query cache and every
     * per-node side table. Shared by {@linkcode invalidateAllImpl} and
     * {@linkcode dispose} so a new store added to {@linkcode nodeSideTables} is
     * torn down by both without touching either.
     */
    private clearAllState(): void {
        this.client.getQueryCache().clear();
        this.clearNodeState();
    }

    /**
     * Reconcile a node's direct children against a freshly-fetched set: evict the
     * subtrees of departed children, then (re-)index the new set. Surviving
     * children keep their independently-cached subtrees.
     */
    private reconcileChildren(parentPath: readonly string[], children: T[]): void {
        const newKeys = new Set(children.map(child => this.getKey(child)));
        for (const oldKey of this.tree.directChildKeys(parentPath)) {
            if (!newKeys.has(oldKey)) {
                this.evictSubtree(oldKey);
            }
        }
        this.tree.indexChildren(parentPath, children);
    }

    /** Remove `key` from its parent's cached children list, if that list is cached. */
    private spliceFromParentList(key: string): void {
        const path = this.tree.pathOf(key);
        if (path === undefined) {
            return;
        }
        const parentPath = path.slice(0, -1);
        this.client.setQueryData<T[]>(this.childrenKey(parentPath), old =>
            old?.filter(child => this.getKey(child) !== key));
    }

    /**
     * Wipe all cached data: clear the query cache, flat maps, enrichment promises,
     * and pagers, then fire {@linkcode onDidChange} once with `undefined`. Backs
     * the {@linkcode Everything} target.
     */
    private invalidateAllImpl(): void {
        this.executor.output.debug(`[cache] ${this.name} invalidate all`);
        this.clearAllState();
        this.changeEmitter.fire(undefined);
    }

    /**
     * Trigger a reconciling re-list of the root level. Drops only the root listing
     * query and fires {@linkcode onDidChange} with `undefined`; the next root fetch
     * reconciles the freshly-listed roots against the indexed ones (see
     * {@linkcode fetchRoots}), preserving the subtrees under surviving roots and
     * evicting the subtrees of departed roots. Backs the {@linkcode Roots} target.
     *
     * Unlike {@linkcode invalidateAllImpl}, this does **not** wipe the tree -- it
     * is the right tool when only the *set* of roots may have changed (e.g. an
     * account signed in/out) but the data under surviving roots is still valid.
     */
    private invalidateRootImpl(): void {
        this.executor.output.debug(`[cache] ${this.name} invalidate root (reconcile)`);
        this.client.removeQueries({ queryKey: this.childrenKey([]), exact: true });
        this.changeEmitter.fire(undefined);
    }

    /**
     * Handle a provider's optional {@linkcode DataProvider.onDidChange} event by
     * routing its {@linkcode DataProviderChangeEvent.target target} to
     * {@linkcode remove} (when {@linkcode DataProviderChangeEvent.remove} is
     * `true`) or {@linkcode invalidate}.
     */
    protected override onProviderChanged(event: DataProviderChangeEvent<T>): void {
        if (event.remove) {
            this.remove(event.target);
        } else {
            this.invalidate(event.target);
        }
    }

    public override dispose(): void {
        this.clearAllState();
        this.client.clear();
        super.dispose();
    }

    // -- path / prefix helpers ----------------------------------------------

    /** The children-query key for a node path (empty path = the root listing). */
    private childrenKey(path: readonly string[]): QueryKey {
        return [CHILDREN, ...path];
    }
}
