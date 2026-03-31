/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IActionExecutor } from '../base/IActionExecutor';
import { InflightMap } from '../data/InflightMap';
import { isAsyncIterable, type Page } from '../data/Page';
import { Disposable } from '../vscode/Disposable';
import type { DataProvider } from './DataProvider';
import { NodeMap } from './NodeMap';
import { ProviderRegistry } from './ProviderRegistry';

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
}

/**
 * A lazily-loaded, cached tree of data items built up piecewise by
 * {@link DataProvider}s.
 *
 * Each node's children are loaded on first access and cached until stale.
 * The tree is the single source of truth for the data layer -- the
 * `TreeDataProvider`s are view-only and read from it.
 *
 * TODO: add tests
 *
 * @typeParam T - The data item type stored in the tree.
 */
export class DataItemTree<T> extends ProviderRegistry<T, DataProvider<T>> {
    private readonly nodes = new NodeMap<TreeNode<T>>(node => this.getKey(node.resource));

    /**
     * Per-resource enrichment promises, keyed by resource key.
     * Stored when {@link enrichAll} kicks off background enrichment so
     * that callers (e.g. commands) can await completion via
     * {@link whenEnriched}.
     */
    private readonly enrichmentPromises = new Map<string, Promise<void>>();

    /**
     * Per-resource in-flight page-load promises. Prevents concurrent
     * `next()` calls on the same async iterator when `loadMore` /
     * `loadAll` overlap (e.g. user click + programmatic load).
     */
    private readonly loadsInFlight = new InflightMap<void>();

    /**
     * Transient per-node state labels (e.g. `'deleting'`, `'updating'`).
     * Keyed by resource key; each key maps to the set of active states.
     * View providers can read these to render visual feedback for
     * in-progress operations without coupling to specific data providers.
     *
     * State is scoped to cached tree nodes: when a node (or an entire
     * subtree) is evicted from the cache, its entry and all descendant
     * entries are removed from this map. This includes subtree
     * invalidation and branch refresh operations (e.g.
     * `invalidate(..., includeChildren: true)` or `getChildren`
     * refreshes). Callers should not assume state persists across such
     * refreshes and must reapply any required state after nodes are
     * reloaded.
     */
    private readonly nodeStates = new Map<string, Set<string>>();

    /** Cached root nodes and their staleness timestamp. */
    private roots: TreeNode<T>[] | undefined;
    private rootsStaleAt = 0;

    public readonly onDidChange = this.changeEmitter.event;

    /**
     * @param name - A short identifier for this tree instance (e.g.
     *   `'resources'`, `'activity'`). Stamped on every telemetry event as
     *   `properties.tree`.
     * @param executor - Action executor for wrapping provider calls in
     *   telemetry scopes. Every {@link DataProvider.getChildren} and
     *   {@link DataProvider.enrich} call runs inside
     *   {@link IActionExecutor.callWithTelemetryAndErrorHandling}, which
     *   establishes an {@link IActionContext} on the async call stack via
     *   `AsyncLocalStorage`. Pipeline policies (e.g. `CorrelationIdPolicy`)
     *   pick up this context automatically without any changes to provider
     *   or client signatures.
     * @param getKey - Extracts a unique string key from a resource.
     * @param ttl - Time-to-live in milliseconds for cached children.
     */
    public constructor(
        private readonly name: string,
        private readonly executor: IActionExecutor,
        private readonly getKey: (resource: T) => string,
        private readonly ttl: number,
    ) {
        super();
    }

    /**
     * Register a provider. If the provider has an {@link DataProvider.onDidChange}
     * event, the tree automatically subscribes and invalidates accordingly.
     */
    public override registerProvider(provider: DataProvider<T>): Disposable {
        const registration = super.registerProvider(provider);

        const changeSubscription = provider.onDidChange?.((event) => {
            if (event.resource !== undefined && event.resource !== null) {
                this.invalidate(event.resource, event.includeChildren);
            } else {
                this.invalidateAll();
            }
        });

        return Disposable.from(registration, changeSubscription ?? Disposable.None);
    }

    /**
     * Get children for the given resource, or the root-level resources when
     * called with `undefined` — mirroring VSCode's `TreeDataProvider.getChildren`.
     *
     * Results are lazily loaded and cached with TTL.
     */
    public async getChildren(resource?: T): Promise<T[]> {
        if (resource === undefined) {
            return this.getRootChildren();
        }

        return this.getBranchChildren(resource);
    }

    private async getRootChildren(): Promise<T[]> {
        if (this.roots !== undefined && Date.now() < this.rootsStaleAt) {
            return this.roots.map(n => n.resource);
        }

        // Clear all cached nodes when recomputing roots since the whole tree may have changed
        this.nodes.clear();
        this.roots = undefined;

        // TODO: concurrency limits
        // Each root provider gets its own telemetry scope so that
        // concurrent calls don't overwrite shared mutable properties.
        const results = await Promise.all(
            this.getRootProviders()
                .map(async p => this.executor.callWithTelemetryAndErrorHandling('tree.getRootChildren', (context) => {
                    context.telemetry.isUserEvent = false;
                    context.errorHandling.rethrow = true;
                    context.telemetry.properties.tree = this.name;
                    context.telemetry.properties.provider = p.constructor.name;

                    return Promise.resolve(p.getChildren());
                })),
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

        this.roots = resources.map(resource => {
            const node: TreeNode<T> = { resource, children: undefined, staleAt: 0, parent: undefined };
            this.nodes.set(this.getKey(resource), node);
            return node;
        });
        this.rootsStaleAt = Date.now() + this.ttl;

        this.enrichAll(resources);

        return resources;
    }

    private async getBranchChildren(resource: T): Promise<T[]> {
        const key = this.getKey(resource);
        const node = this.nodes.get(key);

        if (!node) {
            throw new Error(`Resource not found in tree: ${key}`);
        }

        if (node.children !== undefined && Date.now() < node.staleAt) {
            return node.children.map(n => n.resource);
        }

        // Find the provider that handles this resource
        const provider = this.findProvider(resource);
        if (!provider) {
            node.children = [];
            node.staleAt = Date.now() + this.ttl;
            return [];
        }

        // Remove previously cached descendants that may no longer be present
        this.clearSubtreeStates(node.children);
        this.nodes.removeSubtrees(node.children);
        node.children = [];
        node.pageIterator = undefined;

        const result = await this.executor.callWithTelemetryAndErrorHandling('tree.getBranchChildren', (context) => {
            context.telemetry.isUserEvent = false;
            context.errorHandling.rethrow = true;
            context.telemetry.properties.tree = this.name;
            context.telemetry.properties.provider = provider.constructor.name;
            return provider.getChildren(resource);
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

        node.staleAt = Date.now() + this.ttl;

        return node.children.map(n => n.resource);
    }

    /**
     * For each resource, find the provider that handles it and call
     * {@link DataProvider.enrich enrich} if present. Enrichment runs in the
     * background - each resolved call fires {@link onDidChange} for that resource.
     *
     * The resulting promise for each resource is stored so that callers
     * can await enrichment completion via {@link whenEnriched}.
     */
    private enrichAll(resources: T[]): void {
        // TODO: concurrency limits
        for (const resource of resources) {
            const provider = this.findProvider(resource);
            if (provider?.enrich) {
                const key = this.getKey(resource);
                const promise = this.executor
                    .callWithTelemetryAndErrorHandling('tree.enrich', (context) => {
                        context.telemetry.isUserEvent = false;
                        context.telemetry.suppress = 'onSuccess'; // TODO: should we be suppressing?
                        context.errorHandling.rethrow = true;
                        context.telemetry.properties.tree = this.name;
                        context.telemetry.properties.provider = provider.constructor.name;
                        return provider.enrich!(resource); // eslint-disable-line @typescript-eslint/no-non-null-assertion -- It's asserted non-null above
                    })
                    .then((includeChildren) => {
                        this.enrichmentPromises.delete(key);
                        // Guard: if the node was removed (e.g. via removeItem) while
                        // enrichment was in flight, skip the invalidation to avoid
                        // spurious change events for items no longer in the tree.
                        if (this.nodes.get(key)) {
                            this.invalidate(resource, includeChildren);
                        }
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
     * If displaying a loading toast, it is suggested to use `{@link withDelayedProgress}`
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
     * Fires {@link onDidChange} so the view refreshes automatically;
     * callers should use {@link getChildren} to read the updated list.
     *
     * @throws if {@link getChildren} has not been called for this resource yet.
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
     * exhausted. Fires {@link onDidChange} after all pages are loaded so the
     * view refreshes only once.
     *
     * If children have not been loaded yet (i.e. {@link getChildren} was
     * never called for this resource), the initial load is triggered first.
     */
    public async loadAll(resource: T): Promise<void> {
        await this.executor.callWithTelemetryAndErrorHandling('tree.loadAll', async (context) => {
            context.telemetry.isUserEvent = false;
            context.errorHandling.rethrow = true;
            context.telemetry.properties.tree = this.name;

            const key = this.getKey(resource);
            const node = this.nodes.get(key);

            // Ensure children are initialized (first page pulled) before
            // exhausting remaining pages.
            if (node?.children === undefined) {
                await this.getChildren(resource);
            }

            while (this.hasMore(resource)) {
                await this.loadOnePage(resource);
            }
        });
        this.changeEmitter.fire(resource);
    }

    private async loadOnePage(resource: T): Promise<void> {
        const key = this.getKey(resource);
        await this.loadsInFlight.getOrRun(key, async () => {
            const node = this.nodes.get(key);
            if (!node?.pageIterator) {
                return;
            }

            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- The result will be defined (or an error rethrown)
            const next = (await this.executor.callWithTelemetryAndErrorHandling('tree.loadMore', (context) => {
                context.telemetry.isUserEvent = false;
                context.errorHandling.rethrow = true;
                context.telemetry.properties.tree = this.name;
                return node.pageIterator!.next(); // eslint-disable-line @typescript-eslint/no-non-null-assertion -- It's asserted non-null above
            }))!;

            if (next.done) {
                node.pageIterator = undefined;
            } else if (this.nodes.get(key) !== node) {
                // The node was removed (e.g. via removeItem) while the
                // page load was in flight--discard the results to avoid
                // re-inserting orphaned children into the map.
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
     * Create {@link TreeNode}s for the given resources, register them in
     * the {@link NodeMap}, and kick off background enrichment.
     */
    private addChildNodes(children: T[], parent: TreeNode<T>): TreeNode<T>[] {
        const nodes = children.map(child => {
            const childNode: TreeNode<T> = { resource: child, children: undefined, staleAt: 0, parent };
            this.nodes.set(this.getKey(child), childNode);
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
     * Invalidate a specific resource, optionally including its cached
     * children. Fires {@link onDidChange}.
     *
     * @param resource - The resource to invalidate. {@link ViewItemTree}
     *   will see the event and re-render the corresponding tree item.
     * @param includeChildren - When `true` (default), cached children are
     *   removed from the tree and will be re-fetched on next access. When
     *   `false`, children will still be re-rendered, but the next access
     *   will hit the cache, avoiding a re-fetch (unless they are stale).
     */
    public invalidate(resource: T, includeChildren = true): void {
        const node = this.nodes.get(this.getKey(resource));
        if (node && includeChildren) {
            this.clearSubtreeStates(node.children);
            this.nodes.removeSubtrees(node.children);
            node.children = undefined;
            node.staleAt = 0;
            node.pageIterator = undefined;
        }
        this.changeEmitter.fire(resource);
    }

    /**
     * Remove a single item from the cache. Its subtree is evicted and the
     * item is spliced out of the parent's children list. For non-root items,
     * fires {@link onDidChange} for the parent so the view re-renders without
     * re-fetching siblings. For root items, fires {@link onDidChange} with
     * `undefined` to signal a full refresh.
     *
     * If the item is not in the cache, this is a no-op.
     */
    public removeItem(resource: T): void {
        const key = this.getKey(resource);
        const node = this.nodes.get(key);
        if (!node) {
            return;
        }

        // Remove the node and its entire subtree from the map
        this.clearSubtreeStates([node]);
        this.nodes.removeSubtrees([node]);
        this.enrichmentPromises.delete(key);

        const parent = node.parent;
        if (parent) {
            // Splice out of the parent's children array
            const childIdx = parent.children?.indexOf(node) ?? -1;
            if (childIdx !== -1) {
                parent.children!.splice(childIdx, 1); // eslint-disable-line @typescript-eslint/no-non-null-assertion -- indexOf succeeded
            }
            this.invalidate(parent.resource, false);
        } else {
            // Root item -- splice out of roots array
            if (this.roots) {
                const rootIdx = this.roots.indexOf(node);
                if (rootIdx !== -1) {
                    this.roots.splice(rootIdx, 1);
                }
            }

            // Must directly fire the emitter; `invalidate()` at the root [or `invalidateAll()`] would evict the entire tree which is not what we want
            this.changeEmitter.fire(undefined);
        }
    }

    /**
     * Invalidate all cached data. Clears the entire node map and root cache.
     * Fires {@link onDidChange} once with `undefined` (full refresh).
     */
    public invalidateAll(): void {
        this.nodes.clear();
        this.enrichmentPromises.clear();
        this.nodeStates.clear();
        this.roots = undefined;
        this.rootsStaleAt = 0;
        this.changeEmitter.fire(undefined);
    }

    // #region Transient node state

    /**
     * Recursively clear all transient states for nodes and their descendants.
     */
    private clearSubtreeStates(nodes: TreeNode<T>[] | undefined): void {
        if (!nodes) {
            return;
        }
        for (const node of nodes) {
            this.clearSubtreeStates(node.children);
            this.nodeStates.delete(this.getKey(node.resource));
        }
    }

    /**
     * Mark a resource with a transient state label (e.g. `'deleting'`,
     * `'updating'`). Fires {@link onDidChange} so that view providers
     * can re-render the node with visual feedback (spinner, dimmed label,
     * disabled commands, etc.).
     *
     * The state is purely advisory -- it does not affect caching or
     * data fetching. Call {@link clearState} when the operation completes.
     *
     * @param resource - The resource to mark.
     * @param state - An arbitrary label identifying the operation.
     */
    public markState(resource: T, state: string): void {
        const key = this.getKey(resource);
        if (!this.nodes.get(key)) {
            return;
        }
        let states = this.nodeStates.get(key);
        if (!states) {
            states = new Set();
            this.nodeStates.set(key, states);
        }
        if (!states.has(state)) {
            states.add(state);
            this.changeEmitter.fire(resource);
        }
    }

    /**
     * Remove a transient state label from a resource. Does **not** fire
     * {@link onDidChange} on its own -- callers are expected to follow
     * up with {@link invalidate} or {@link removeItem} which will
     * trigger re-rendering.
     */
    public clearState(resource: T, state: string): void {
        const key = this.getKey(resource);
        const states = this.nodeStates.get(key);
        if (states) {
            states.delete(state);
            if (states.size === 0) {
                this.nodeStates.delete(key);
            }
        }
    }

    /**
     * Check whether a resource currently has a specific transient state.
     */
    public hasState(resource: T, state: string): boolean {
        return this.nodeStates.get(this.getKey(resource))?.has(state) ?? false;
    }

    // #endregion
}
