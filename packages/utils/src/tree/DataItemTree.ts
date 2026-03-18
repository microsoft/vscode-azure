/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InflightMap } from '../data/InflightMap';
import { Disposable } from '../vscode/Disposable';
import { isAsyncIterable, type Page } from '../data/Page';
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

    /** Cached root nodes and their staleness timestamp. */
    private roots: TreeNode<T>[] | undefined;
    private rootsStaleAt = 0;

    public readonly onDidChange = this.changeEmitter.event;

    /**
     * @param getKey - Extracts a unique string key from a resource.
     * @param ttl - Time-to-live in milliseconds for cached children.
     */
    public constructor(
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
        const results = await Promise.all(
            this.getRootProviders()
                .map(p => Promise.resolve(p.getChildren())),
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
            const node: TreeNode<T> = { resource, children: undefined, staleAt: 0 };
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
        this.nodes.removeSubtrees(node.children);
        node.children = [];
        node.pageIterator = undefined;

        const result = await provider.getChildren(resource);

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
            node.children = this.addChildNodes(result);
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
                const promise = Promise
                    .resolve(provider.enrich(resource))
                    .then((includeChildren) => {
                        this.enrichmentPromises.delete(key);
                        this.invalidate(resource, includeChildren);
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
        this.changeEmitter.fire(resource);
    }

    private async loadOnePage(resource: T): Promise<void> {
        const key = this.getKey(resource);
        await this.loadsInFlight.getOrRun(key, async () => {
            const node = this.nodes.get(key);
            if (!node?.pageIterator) {
                return;
            }

            const next = await node.pageIterator.next();

            if (next.done) {
                node.pageIterator = undefined;
            } else {
                node.children = [...(node.children ?? []), ...this.addChildNodes(next.value.items)];
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
    private addChildNodes(children: T[]): TreeNode<T>[] {
        const nodes = children.map(child => {
            const childNode: TreeNode<T> = { resource: child, children: undefined, staleAt: 0 };
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
            this.nodes.removeSubtrees(node.children);
            node.children = undefined;
            node.staleAt = 0;
            node.pageIterator = undefined;
        }
        this.changeEmitter.fire(resource);
    }

    /**
     * Invalidate all cached data. Clears the entire node map and root cache.
     * Fires {@link onDidChange} once with `undefined` (full refresh).
     */
    public invalidateAll(): void {
        this.nodes.clear();
        this.enrichmentPromises.clear();
        this.roots = undefined;
        this.rootsStaleAt = 0;
        this.changeEmitter.fire(undefined);
    }
}
