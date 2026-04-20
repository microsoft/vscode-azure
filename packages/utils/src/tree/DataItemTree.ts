/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IActionExecutor } from '../base/IActionExecutor';
import { InflightMap } from '../data/InflightMap';
import { isAsyncIterable, type Page } from '../data/Page';
import type { Disposable } from '../vscode/Disposable';
import type { IOutputChannel } from '../vscode/IOutputChannel';
import type { IVsCode } from '../vscode/IVsCode';
import type { DataProvider, DataProviderChangeEvent } from './DataProvider';
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
        private readonly output?: IOutputChannel,
    ) {
        super();
    }

    /**
     * Get children for the given resource, or the root-level resources when
     * called with `undefined` -- mirroring VSCode's
     * {@linkcode vscode.TreeDataProvider.getChildren TreeDataProvider.getChildren}.
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
            this.output?.trace(`[cache] ${this.name} root cache hit (count=${this.roots.length})`);
            return this.roots.map(n => n.resource);
        }
        this.output?.trace(`[cache] ${this.name} root cache miss`);

        // Clear all cached nodes when recomputing roots since the whole tree may have changed
        this.nodes.clear();
        this.roots = undefined;

        // TODO: concurrency limits
        // Each root provider gets its own telemetry scope so that
        // concurrent calls don't overwrite shared mutable properties.
        const rootProviders = this.getRootProviders();
        this.output?.debug(`[data] ${this.name} root fetch start (providers=${rootProviders.length})`);
        const results = await Promise.all(
            rootProviders
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
            const resourceKey = this.getKey(resource);
            this.nodes.set(resourceKey, node);
            this.output?.trace(`[cache] ${this.name} root child key=${resourceKey}`);
            return node;
        });
        this.rootsStaleAt = Date.now() + this.ttl;
        this.output?.debug(`[data] ${this.name} root fetch done (providers=${rootProviders.length} count=${resources.length})`);

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
            this.output?.trace(`[cache] ${this.name} branch cache hit key=${key} count=${node.children.length}`);
            return node.children.map(n => n.resource);
        }
        this.output?.trace(`[cache] ${this.name} branch cache miss key=${key}`);

        // Find the provider that handles this resource
        const provider = this.findProvider(resource);
        if (!provider) {
            node.children = [];
            node.staleAt = Date.now() + this.ttl;
            this.output?.debug(`[data] ${this.name} branch fetch done key=${key} count=0 provider=<none>`);
            return [];
        }

        // Remove previously cached descendants that may no longer be present
        this.nodes.removeSubtrees(node.children);
        node.children = [];
        node.pageIterator = undefined;
        this.output?.debug(`[data] ${this.name} branch fetch start key=${key} provider=${provider.constructor.name}`);

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
        this.output?.debug(`[data] ${this.name} branch fetch done key=${key} count=${node.children.length} provider=${provider.constructor.name}`);

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
        // TODO: concurrency limits
        for (const resource of resources) {
            const provider = this.findProvider(resource);
            if (provider?.enrich) {
                const key = this.getKey(resource);
                this.output?.debug(`[data] ${this.name} enrich start key=${key} provider=${provider.constructor.name}`);
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
                        this.output?.debug(`[data] ${this.name} enrich done key=${key} includeChildren=${includeChildren}`);
                        // Guard: if the node was removed (e.g. via removeItem) while
                        // enrichment was in flight, skip the invalidation to avoid
                        // spurious change events for items no longer in the tree.
                        if (this.nodes.get(key)) {
                            this.invalidate(resource, includeChildren);
                        }
                    })
                    .catch((error: unknown) => {
                        const message = error instanceof Error ? error.message : String(error);
                        this.output?.warn(this.code.l10n.t('[data] {0} enrich failed key={1} provider={2} message={3}', this.name, key, provider.constructor.name, message));
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
     * Create {@linkcode TreeNode}s for the given resources, register them in
     * the {@linkcode NodeMap}, and kick off background enrichment.
     */
    private addChildNodes(children: T[], parent: TreeNode<T>): TreeNode<T>[] {
        const nodes = children.map(child => {
            const childNode: TreeNode<T> = { resource: child, children: undefined, staleAt: 0, parent };
            const childKey = this.getKey(child);
            this.nodes.set(childKey, childNode);
            this.output?.trace(`[cache] ${this.name} child key=${childKey} parent=${this.getKey(parent.resource)}`);
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
     * children. Fires {@linkcode onDidChange}.
     *
     * @param resource - The resource to invalidate. {@linkcode ViewItemTree}
     *   will see the event and re-render the corresponding tree item.
     * @param includeChildren - When `true` (default), cached children are
     *   removed from the tree and will be re-fetched on next access. When
     *   `false`, children will still be re-rendered, but the next access
     *   will hit the cache, avoiding a re-fetch (unless they are stale).
     */
    public invalidate(resource: T, includeChildren = true): void {
        this.output?.debug(`[cache] ${this.name} invalidate key=${this.getKey(resource)} includeChildren=${includeChildren}`);
        const node = this.nodes.get(this.getKey(resource));
        if (node && includeChildren) {
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
     * fires {@linkcode onDidChange} for the parent so the view re-renders without
     * re-fetching siblings. For root items, fires {@linkcode onDidChange} with
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
     * Fires {@linkcode onDidChange} once with `undefined` (full refresh).
     */
    public invalidateAll(): void {
        this.output?.debug(`[cache] ${this.name} invalidate all`);
        this.nodes.clear();
        this.enrichmentPromises.clear();
        this.roots = undefined;
        this.rootsStaleAt = 0;
        this.changeEmitter.fire(undefined);
    }

    /**
     * Handle a provider's optional {@linkcode DataProvider.onDidChange} event by
     * invalidating the changed resource or the entire cache.
     */
    protected override onProviderChanged(event: DataProviderChangeEvent<T>): void {
        if (event.resource !== undefined && event.resource !== null) {
            this.invalidate(event.resource, event.includeChildren);
        } else {
            this.invalidateAll();
        }
    }
}
