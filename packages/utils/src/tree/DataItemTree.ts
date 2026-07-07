/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IActionExecutor } from '../base/IActionExecutor';
import { stringifyError } from '../base/stringifyError';
import { InflightMap } from '../data/InflightMap';
import { Limiter } from '../data/Limiter';
import { isAsyncIterable, type Page } from '../data/Page';
import type { Disposable } from '../vscode/Disposable';
import type { IVsCode } from '../vscode/IVsCode';
import type { DataProvider, DataProviderChangeEvent, FetchOptions } from './DataProvider';
import { NodeMap } from './NodeMap';
import { ProviderRegistry } from './ProviderRegistry';
import { Everything, isKeyMatch, Roots, subtreeOf, type KeyMatch, type MatchScope, type Selector, type Target } from './Selector';

/**
 * Internal node wrapping a resource with its cached children and staleness info.
 * @internal
 */
interface TreeNode<T> {
    readonly resource: T;
    children: TreeNode<T>[] | undefined;  // undefined = not yet loaded
    staleAt: number;            // Date.now() after which children should be re-fetched

    /** Back-pointer to the parent node, or `undefined` for root nodes. */
    parent: TreeNode<T> | undefined;

    /**
     * If the provider returned an `AsyncIterable<Page<T>>`, the in-progress
     * iterator is stored here between page pulls. `undefined` means no
     * more pages are available (or the provider returned a plain array).
     */
    pageIterator?: AsyncIterator<Page<T>>;

    /**
     * Monotonic counter bumped every time this node's subtree is wiped (see
     * {@linkcode DataItemTree.wipeSubtree}). An in-flight page load captures the
     * generation before pulling a page and discards the page if the generation
     * changed meanwhile -- this prevents a page from a superseded iterator from
     * landing in a node that was invalidated (but whose object identity, and
     * therefore map entry, survives) mid-flight.
     */
    generation?: number;
}

/**
 * A lazily-loaded, cached tree of data items built up piecewise by
 * {@linkcode DataProvider}s.
 *
 * Each node's children are loaded on first access and cached until stale.
 * The tree is the single source of truth for the data layer -- the
 * `TreeDataProvider`s are view-only and read from it.
 *
 * @typeParam T - The data item type stored in the tree.
 */
export class DataItemTree<T> extends ProviderRegistry<T, DataProvider<T>> implements Disposable {
    private readonly nodes = new NodeMap<TreeNode<T>>(node => this.getKey(node.resource));

    /**
     * Per-resource enrichment promises, keyed by resource key.
     * Stored when {@linkcode enrichAll} kicks off background enrichment so
     * that callers (e.g. commands) can await completion via
     * {@linkcode whenEnriched}.
     */
    private readonly enrichmentPromises = new Map<string, Promise<void>>();

    /**
     * Per-resource in-flight page-load promises. Prevents concurrent
     * `next()` calls on the same async iterator when `loadMore` /
     * `loadAll` overlap (e.g. user click + programmatic load).
     */
    private readonly loadsInFlight = new InflightMap<void>();

    /** Cached root nodes and their staleness timestamp. */
    private roots: TreeNode<T>[] | undefined;
    private rootsStaleAt = 0;

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
     *   `AsyncLocalStorage`. Pipeline policies (e.g. `CorrelationIdPolicy`)
     *   pick up this context automatically without any changes to provider
     *   or client signatures.
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
    }

    /**
     * Get children for the given resource, or the root-level resources when
     * called with `undefined` -- mirroring VSCode's
     * {@linkcode vscode.TreeDataProvider.getChildren TreeDataProvider.getChildren}.
     *
     * Results are lazily loaded and cached with TTL.
     *
     * @param resource - The parent resource, or `undefined` for the roots.
     * @param options - Optional {@linkcode FetchOptions} hints forwarded to the
     *   handling provider on a cache *miss*. They do not participate in the
     *   cache key, so a cache hit ignores them.
     */
    public async getChildren(resource?: T, options?: FetchOptions): Promise<T[]> {
        if (resource === undefined) {
            return this.getRootChildren(options);
        }

        return this.getBranchChildren(resource, options);
    }

    private async getRootChildren(options?: FetchOptions): Promise<T[]> {
        if (this.roots !== undefined && Date.now() < this.rootsStaleAt) {
            this.executor.output.trace(`[cache] ${this.name} root cache hit (count=${this.roots.length})`);
            return this.roots.map(n => n.resource);
        }
        this.executor.output.trace(`[cache] ${this.name} root cache miss`);

        // Each root provider gets its own telemetry scope so that
        // concurrent calls don't overwrite shared mutable properties.
        const rootProviders = this.getRootProviders();
        this.executor.output.debug(`[data] ${this.name} root fetch start (providers=${rootProviders.length})`);
        const limiter = new Limiter<T[] | null | undefined>(5);
        const results = await Promise.all(
            rootProviders
                .map(p => limiter.queue(() => this.executor.callWithTelemetryAndErrorHandling<T[]>('tree.getRootChildren', (context) => {
                    context.telemetry.isUserEvent = false;
                    context.errorHandling.rethrow = true;
                    context.telemetry.properties.tree = this.name;
                    context.telemetry.properties.provider = p.constructor.name;

                    return Promise.resolve(p.getChildren(undefined, options)) as Promise<T[]>;
                }))),
        );

        // Root providers always return plain arrays (pagination at root
        // level is not supported).
        const resources = results.flatMap(result => {
            if (!result) {
                return [];
            } else if (isAsyncIterable(result)) {
                throw new Error('Root providers must return plain arrays, not AsyncIterables');
            }
            return result;
        });

        // Reconcile the freshly-listed roots against the previously cached ones
        // by key, rather than wiping the whole tree. This lets a reconciling
        // root refresh (invalidateRoot) re-list the top level (e.g. accounts)
        // while preserving the tenant / subscription subtrees under roots that
        // are still present. After invalidateAll() this.roots is undefined, so
        // this degenerates to a full fresh fetch (the previous behavior).
        const newKeySet = new Set(resources.map(resource => this.getKey(resource)));

        // Evict roots (and their subtrees) that are no longer present.
        for (const rootNode of this.roots ?? []) {
            if (!newKeySet.has(this.getKey(rootNode.resource))) {
                this.nodes.removeSubtrees([rootNode]);
            }
        }

        const rootNodes = resources.map(resource => {
            const resourceKey = this.getKey(resource);
            const existing = this.nodes.get(resourceKey);
            if (existing) {
                // Root still present: keep its node (and cached subtree,
                // staleAt, and pageIterator) as-is.
                this.executor.output.trace(`[cache] ${this.name} root child key=${resourceKey} (preserved)`);
                return existing;
            }
            const node: TreeNode<T> = { resource, children: undefined, staleAt: 0, parent: undefined };
            this.nodes.set(resourceKey, node);
            this.executor.output.trace(`[cache] ${this.name} root child key=${resourceKey}`);
            return node;
        });
        this.roots = rootNodes;
        this.rootsStaleAt = this.computeStaleAt(this.rootTtl(rootProviders));
        this.executor.output.debug(`[data] ${this.name} root fetch done (providers=${rootProviders.length} count=${resources.length})`);

        const rootResources = rootNodes.map(n => n.resource);
        this.enrichAll(rootResources);

        return rootResources;
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

    /**
     * Compute an absolute staleness timestamp from a TTL. A TTL of `Infinity`
     * yields `Infinity` (never stale); any finite TTL yields `Date.now() + ttl`.
     */
    private computeStaleAt(ttl: number): number {
        return ttl === Infinity ? Infinity : Date.now() + ttl;
    }

    private async getBranchChildren(resource: T, options?: FetchOptions): Promise<T[]> {
        const key = this.getKey(resource);
        const node = this.nodes.get(key);

        if (!node) {
            throw new Error(`Resource not found in tree: ${key}`);
        }

        if (node.children !== undefined && Date.now() < node.staleAt) {
            this.executor.output.trace(`[cache] ${this.name} branch cache hit key=${key} count=${node.children.length}`);
            return node.children.map(n => n.resource);
        }
        this.executor.output.trace(`[cache] ${this.name} branch cache miss key=${key}`);

        // Find the provider that handles this resource
        const provider = this.findProvider(resource);
        if (!provider) {
            this.wipeSubtree(node);
            node.children = [];
            node.staleAt = this.computeStaleAt(this.ttl);
            this.executor.output.debug(`[data] ${this.name} branch fetch done key=${key} count=0 provider=<none>`);
            return [];
        }

        // Remove previously cached descendants that may no longer be present
        // (also clears their enrichment promises and bumps this node's
        // generation so any in-flight page load is discarded).
        this.wipeSubtree(node);
        node.children = [];
        this.executor.output.debug(`[data] ${this.name} branch fetch start key=${key} provider=${provider.constructor.name}`);

        const result = await this.executor.callWithTelemetryAndErrorHandling('tree.getBranchChildren', (context) => {
            context.telemetry.isUserEvent = false;
            context.errorHandling.rethrow = true;
            context.telemetry.properties.tree = this.name;
            context.telemetry.properties.provider = provider.constructor.name;
            return provider.getChildren(resource, options);
        });

        if (!result) {
            // No children -- leave the empty array
        } else if (isAsyncIterable(result)) {
            // Paged result: store the iterator, then pull the first page.
            // Use loadOnePage directly (not loadMore) to avoid firing
            // onDidChange before staleAt is set -- otherwise listeners
            // could re-enter getChildren, see staleAt=0, and reset the
            // iterator.
            node.pageIterator = result[Symbol.asyncIterator]();
            await this.loadOnePage(resource);
        } else {
            node.children = this.addChildNodes(result, node);
        }

        node.staleAt = this.computeStaleAt(provider.getTtl?.(resource) ?? this.ttl);
        this.executor.output.debug(`[data] ${this.name} branch fetch done key=${key} count=${node.children.length} provider=${provider.constructor.name}`);

        return node.children.map(n => n.resource);
    }

    /**
     * For each resource, find the provider that handles it and call
     * {@linkcode DataProvider.enrich enrich} if present. Enrichment runs in the
     * background - each resolved call fires {@linkcode onDidChange} for that resource.
     *
     * The resulting promise for each resource is stored so that callers
     * can await enrichment completion via {@linkcode whenEnriched}.
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
                        return provider.enrich!(resource); // eslint-disable-line @typescript-eslint/no-non-null-assertion -- It's asserted non-null above
                    }))
                    .then((includeChildren) => {
                        this.enrichmentPromises.delete(key);
                        this.executor.output.debug(`[data] ${this.name} enrich done key=${key} includeChildren=${includeChildren}`);
                        // Guard: if the node was removed (e.g. via remove) while
                        // enrichment was in flight, skip the invalidation to avoid
                        // spurious change events for items no longer in the tree.
                        if (this.nodes.get(key)) {
                            // `includeChildren` is `undefined` only if enrichment was
                            // suppressed/errored; default to re-fetching children, matching
                            // the historical default-parameter behavior.
                            this.invalidateEntries([resource], (includeChildren ?? true) ? 'subtree' : 'self');
                        }
                    })
                    .catch((error: unknown) => {
                        const message = stringifyError(error);
                        this.executor.output.warn(this.code.l10n.t('[data] {0} enrich failed key={1} provider={2} message={3}', this.name, key, provider.constructor.name, message));
                        throw error;
                    });
                this.enrichmentPromises.set(key, promise);
                // Attach a rejection handler so background rejections are not unhandled
                void promise.catch(() => { /* noop */ });
            }
        }
    }

    /**
     * Returns a promise that resolves once enrichment has completed for
     * the given resource.
     *
     * If no enrichment provider matched the resource (or enrichment has
     * already finished), the promise resolves immediately.
     *
     * If enrichment fails, the promise rejects with the error but does not
     * retry automatically. Callers that await this method should be prepared
     * to handle rejections.
     *
     * The optional type parameter `TEnriched` lets callers narrow the
     * return type to a branded subtype whose once-optional enrichment
     * properties are guaranteed to be populated:
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
     * Returns `true` when the provider that produced children for the
     * given resource has more pages available (i.e. the async iterator
     * has not yet been exhausted).
     */
    public hasMore(resource?: T): boolean {
        if (resource === undefined) {
            return false; // Root-level pagination not supported
        }
        const key = this.getKey(resource);
        return !!this.nodes.get(key)?.pageIterator;
    }

    /**
     * Pull the next page from the stored async iterator for the given
     * resource. The new children are appended to the cache and enriched.
     * Fires {@linkcode onDidChange} so the view refreshes automatically;
     * callers should use {@linkcode getChildren} to read the updated list.
     *
     * @throws if {@linkcode getChildren} has not been called for this resource yet.
     */
    public async loadMore(resource: T): Promise<void> {
        const key = this.getKey(resource);
        const node = this.nodes.get(key);
        if (node?.children === undefined) {
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
     * If children have not been loaded yet (i.e. {@linkcode getChildren} was
     * never called for this resource), the initial load is triggered first.
     */
    public async loadAll(resource: T): Promise<void> {
        const didLoad = await this.executor.callWithTelemetryAndErrorHandling('tree.loadAll', async (context) => {
            context.telemetry.isUserEvent = false;
            context.errorHandling.rethrow = true;
            context.telemetry.properties.tree = this.name;

            const key = this.getKey(resource);
            const node = this.nodes.get(key);
            let loaded = false;

            // Ensure children are initialized (first page pulled) before
            // exhausting remaining pages.
            if (node?.children === undefined) {
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
            const node = this.nodes.get(key);
            if (!node?.pageIterator) {
                return;
            }
            const generation = node.generation;

            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- The result will be defined (or an error rethrown)
            const next = (await this.executor.callWithTelemetryAndErrorHandling('tree.loadMore', (context) => {
                context.telemetry.isUserEvent = false;
                context.errorHandling.rethrow = true;
                context.telemetry.properties.tree = this.name;
                return node.pageIterator!.next(); // eslint-disable-line @typescript-eslint/no-non-null-assertion -- It's asserted non-null above
            }))!;

            if (this.nodes.get(key) !== node || node.generation !== generation) {
                // The node was removed (e.g. via remove()) or its subtree was
                // wiped (e.g. via invalidate()) while this page was in flight.
                // Discard the page without touching the node -- a fresh fetch
                // may have installed a new iterator we must not clobber.
                return;
            }

            if (next.done) {
                node.pageIterator = undefined;
            } else {
                node.children = [...(node.children ?? []), ...this.addChildNodes(next.value.items, node)];
                if (!next.value.hasMore) {
                    node.pageIterator = undefined;
                }
            }
        });
    }

    /**
     * Create {@linkcode TreeNode}s for the given resources, register them in
     * the {@linkcode NodeMap}, and kick off background enrichment.
     */
    private addChildNodes(children: T[], parent: TreeNode<T>): TreeNode<T>[] {
        const nodes = children.map(child => {
            const childNode: TreeNode<T> = { resource: child, children: undefined, staleAt: 0, parent };
            const childKey = this.getKey(child);
            this.nodes.set(childKey, childNode);
            this.executor.output.trace(`[cache] ${this.name} child key=${childKey} parent=${this.getKey(parent.resource)}`);
            return childNode;
        });
        this.enrichAll(children);
        return nodes;
    }

    /**
     * Get a resource by key from the tree, if it has been loaded.
     */
    public get(key: string): T | undefined {
        return this.nodes.get(key)?.resource;
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
     * - a {@linkcode Selector} -> a verdict predicate evaluated over every
     *   loaded node (e.g. `bySubscription(id)`);
     * - {@linkcode Roots} -> reconciling root re-list (preserve surviving roots'
     *   subtrees);
     * - {@linkcode Everything} -> wipe the entire cache.
     *
     * The change event fires once per *apex* (a matched node with no matched
     * ancestor) after the whole traversal completes, so a single call produces
     * the minimal set of re-renders and is safe against re-entrancy.
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
     * opposed to {@linkcode invalidate} which keeps the node and re-fetches.
     * Each matched node is evicted and spliced out of its parent's child list;
     * for non-root removals {@linkcode onDidChange} fires for the parent (so the
     * view re-renders without re-fetching siblings), and for root removals it
     * fires with `undefined` (full refresh). Matched apexes absorb their
     * subtrees, and parent fires are de-duplicated.
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

        const matched = typeof target === 'function'
            ? this.collectMatches(target as Selector<T>)
            : this.nodesForKeys(this.toKeySet(this.toKeyMatch(target).match));

        this.removeNodes(matched);
    }

    /**
     * Wipe a node's subtree: evict every descendant from the {@linkcode NodeMap}
     * (clearing their enrichment promises too), drop this node's cached children
     * and page iterator, mark it stale, and bump its generation so an in-flight
     * page load for the previous generation is discarded.
     *
     * This is the single primitive every subtree-drop site routes through, so
     * enrichment-promise eviction and the generation bump can never be skipped.
     */
    private wipeSubtree(node: TreeNode<T>): void {
        for (const removedKey of this.nodes.removeSubtrees(node.children)) {
            this.enrichmentPromises.delete(removedKey);
        }
        node.children = undefined;
        node.pageIterator = undefined;
        node.staleAt = 0;
        node.generation = (node.generation ?? 0) + 1;
    }

    /** Normalize a resource / key / array input into a flat list of entries. */
    private toEntries(input: T | string | ReadonlyArray<T | string>): ReadonlyArray<T | string> {
        return Array.isArray(input) ? input as ReadonlyArray<T | string> : [input as T | string];
    }

    /**
     * Normalize a by-key target into a {@linkcode KeyMatch}: a {@linkcode selfOnly}
     * / {@linkcode subtreeOf} descriptor passes through unchanged, while a bare
     * resource / key / array is wrapped as {@linkcode subtreeOf} (the subtree
     * default for raw targets).
     */
    private toKeyMatch(target: KeyMatch<T> | T | string | ReadonlyArray<T | string>): KeyMatch<T> {
        return isKeyMatch<T>(target) ? target : subtreeOf(...this.toEntries(target));
    }

    /** Map resources/keys to a set of cache keys, honoring {@linkcode getKey}. */
    private toKeySet(input: T | string | ReadonlyArray<T | string>): Set<string> {
        return new Set(this.toEntries(input).map(entry => typeof entry === 'string' ? entry : this.getKey(entry)));
    }

    /** Resolve the loaded nodes for the given keys (absent keys are skipped). */
    private nodesForKeys(keys: Set<string>): TreeNode<T>[] {
        const nodes: TreeNode<T>[] = [];
        for (const key of keys) {
            const node = this.nodes.get(key);
            if (node) {
                nodes.push(node);
            }
        }
        return nodes;
    }

    /**
     * Key-based invalidation over a list of resource/key entries.
     *
     * For a `'subtree'` scope, a *loaded* node's cached subtree is wiped so it
     * re-fetches on next access. The change event is then fired so the view
     * re-renders. When the entry is a resource object the *passed* resource is
     * fired unconditionally -- even if the data layer has no node for it -- so a
     * view-layer node that exists independently of the data layer still
     * refreshes (the historical positional-`invalidate` behavior). When the
     * entry is a bare key string and no node is loaded, there is no resource to
     * fire, so it is skipped.
     */
    private invalidateEntries(entries: ReadonlyArray<T | string>, scope: MatchScope): void {
        const fires: T[] = [];
        for (const entry of entries) {
            const isKey = typeof entry === 'string';
            const node = this.nodes.get(isKey ? entry : this.getKey(entry));
            if (node && scope === 'subtree') {
                this.wipeSubtree(node);
            }
            if (!isKey) {
                fires.push(entry);
            } else if (node) {
                fires.push(node.resource);
            }
        }
        for (const resource of fires) {
            this.changeEmitter.fire(resource);
        }
    }

    /**
     * Depth-first invalidation driven by a {@linkcode Selector} verdict. A
     * `'subtree'` verdict wipes the node and stops descending (the apex absorbs
     * its subtree); a `'self'` verdict re-renders the label and keeps
     * descending. Each apex fires once; a match under an already-fired ancestor
     * does not re-fire. Fires happen after the traversal for re-entrancy safety.
     */
    private invalidateSelector(selector: Selector<T>): void {
        const fires: T[] = [];
        const visit = (node: TreeNode<T>, ancestorFired: boolean): void => {
            const scope = selector(node.resource);
            let fired = ancestorFired;
            if (scope === 'subtree') {
                this.wipeSubtree(node);
                if (!ancestorFired) {
                    fires.push(node.resource);
                }
                return; // Stop descending: the subtree is evicted.
            }
            if (scope === 'self' && !ancestorFired) {
                fires.push(node.resource);
                fired = true;
            }
            for (const child of node.children ?? []) {
                visit(child, fired);
            }
        };
        for (const root of this.roots ?? []) {
            visit(root, false);
        }
        for (const resource of fires) {
            this.changeEmitter.fire(resource);
        }
    }

    /**
     * Collect the matched apexes for a selector-driven {@linkcode remove}: a
     * matched node's subtree is removed wholesale, so the traversal stops
     * descending past a match (a `'self'` vs `'subtree'` verdict is irrelevant
     * to removal -- any verdict means "remove this subtree").
     */
    private collectMatches(selector: Selector<T>): TreeNode<T>[] {
        const matched: TreeNode<T>[] = [];
        const visit = (node: TreeNode<T>): void => {
            if (selector(node.resource)) {
                matched.push(node);
                return; // Whole subtree will be removed; don't descend.
            }
            for (const child of node.children ?? []) {
                visit(child);
            }
        };
        for (const root of this.roots ?? []) {
            visit(root);
        }
        return matched;
    }

    /**
     * Evict the given matched nodes. Nodes that have a matched ancestor are
     * skipped (their ancestor's removal already evicts them). Parent fires are
     * de-duplicated; if any root was removed, a single full-refresh
     * (`undefined`) fire subsumes the rest.
     */
    private removeNodes(matched: TreeNode<T>[]): void {
        if (matched.length === 0) {
            return;
        }
        const matchedSet = new Set(matched);
        const parentFires = new Set<T>();
        let fireRoot = false;
        for (const node of matched) {
            if (this.hasMatchedAncestor(node, matchedSet)) {
                continue;
            }
            const parentResource = this.removeNodeInternal(node);
            if (parentResource === undefined) {
                fireRoot = true;
            } else {
                parentFires.add(parentResource);
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

    /** Whether any ancestor of {@linkcode node} is in the matched set. */
    private hasMatchedAncestor(node: TreeNode<T>, matchedSet: Set<TreeNode<T>>): boolean {
        for (let parent = node.parent; parent; parent = parent.parent) {
            if (matchedSet.has(parent)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Evict a single node and its subtree from the map, clear the evicted
     * enrichment promises, and splice the node out of its parent's children (or
     * the roots array). Does **not** fire; returns the parent resource to fire
     * (or `undefined` if the node was a root, signalling a full refresh).
     */
    private removeNodeInternal(node: TreeNode<T>): T | undefined {
        for (const removedKey of this.nodes.removeSubtrees([node])) {
            this.enrichmentPromises.delete(removedKey);
        }

        const parent = node.parent;
        if (parent) {
            const childIdx = parent.children?.indexOf(node) ?? -1;
            if (childIdx !== -1) {
                parent.children!.splice(childIdx, 1); // eslint-disable-line @typescript-eslint/no-non-null-assertion -- indexOf succeeded
            }
            return parent.resource;
        }

        // Root node -- splice out of the roots array.
        if (this.roots) {
            const rootIdx = this.roots.indexOf(node);
            if (rootIdx !== -1) {
                this.roots.splice(rootIdx, 1);
            }
        }
        return undefined;
    }

    /**
     * Wipe all cached data: clear the node map, enrichment promises, and root
     * cache, then fire {@linkcode onDidChange} once with `undefined`. Backs the
     * {@linkcode Everything} target.
     */
    private invalidateAllImpl(): void {
        this.executor.output.debug(`[cache] ${this.name} invalidate all`);
        this.nodes.clear();
        this.enrichmentPromises.clear();
        this.roots = undefined;
        this.rootsStaleAt = 0;
        this.changeEmitter.fire(undefined);
    }

    /**
     * Trigger a reconciling re-list of the root level. Marks the root listing
     * stale and fires {@linkcode onDidChange} with `undefined`; the next root
     * fetch reconciles the freshly-listed roots against the cached ones by key
     * (see {@linkcode getRootChildren}), preserving the subtrees under roots
     * that are still present and evicting the subtrees of roots that have
     * disappeared. Backs the {@linkcode Roots} target.
     *
     * Unlike {@linkcode invalidateAllImpl}, this does **not** wipe the tree -- it
     * is the right tool when only the *set* of roots may have changed (e.g. an
     * account signed in/out) but the data under surviving roots is still valid.
     */
    private invalidateRootImpl(): void {
        this.executor.output.debug(`[cache] ${this.name} invalidate root (reconcile)`);
        this.rootsStaleAt = 0;
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
}
