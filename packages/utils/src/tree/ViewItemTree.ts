/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import type { IActionExecutor } from '../base/IActionExecutor';
import { InflightMap } from '../data/InflightMap';
import type { Disposable } from '../vscode/Disposable';
import type { IOutputChannel } from '../vscode/IOutputChannel';
import type { ITreeItem } from '../vscode/IVsCode';
import type { DataItemTree } from './DataItemTree';
import type { DataProviderChangeEvent } from './DataProvider';
import { NodeMap } from './NodeMap';
import { ProviderRegistry } from './ProviderRegistry';
import type { ViewProvider } from './ViewProvider';

/**
 * Options for constructing a {@linkcode ViewItemTree}.
 *
 * @typeParam TViewItem - The view item type stored in the tree.
 * @typeParam TResource - The resource type stored in the underlying {@linkcode DataItemTree}.
 */
export interface ViewItemTreeOptions<TViewItem, TResource> {
    /** The underlying data tree that the view tree reads resources from. */
    readonly dataItemTree: DataItemTree<TResource>;
    /** Map a data-layer resource to its corresponding view item. */
    readonly toViewItem: (resource: TResource) => TViewItem;
    /** Extract the unique string key of a view item (used for caching and parent lookup). */
    readonly getKey: (viewItem: TViewItem) => string;
    /**
     * Extract the key of the underlying data resource that a view item
     * represents. Used to map view items back to the {@linkcode DataItemTree}
     * for pagination (hasMore / loadMore).
     */
    readonly getResourceKey: (viewItem: TViewItem) => string;
}

/**
 * Optional configuration for "Load More" support.
 *
 * When provided, the tree automatically appends a synthetic "Load More"
 * view item to any branch whose data-layer provider has more pages.
 *
 * All parent-child relationships are expressed as **string keys** so
 * that {@linkcode ViewItemTree} can resolve the real cached view item
 * instead of fabricating a new object (which would break reference
 * equality for non-string view item types).
 *
 * @typeParam TViewItem - The view item type stored in the tree.
 */
export interface LoadMoreOptions<TViewItem> {
    /**
     * Test whether a key represents a synthetic "Load More" node.
     */
    readonly isLoadMoreKey: (key: string) => boolean;

    /**
     * Derive the "Load More" key for a given parent key.
     */
    readonly getLoadMoreKey: (parentKey: string) => string;

    /**
     * Derive the parent key from a "Load More" key.
     * Inverse of {@linkcode getLoadMoreKey}.
     */
    readonly getParentKey: (loadMoreKey: string) => string;

    /**
     * Create a synthetic "Load More" view item for the given key.
     */
    readonly createLoadMoreViewItem: (loadMoreKey: string) => TViewItem;

    /**
     * Build the VS Code tree item to display for "Load More" nodes.
     * @param parentViewItem - The parent view item for which more data will be loaded.
     * @param loading - `true` when a page fetch is already in progress
     * for this node's parent. Implementations should show a spinner and
     * omit the command to prevent additional clicks.
     */
    readonly getTreeItem: (parentViewItem: TViewItem, loading: boolean) => ITreeItem;
}

/**
 * Adapters for creating synthetic "Load More" view items,
 * used by {@linkcode createDefaultLoadMoreOptions}.
 */
export interface LoadMoreAdapter<TViewItem> {
    /** Create a synthetic "Load More" view item from a key. */
    readonly createLoadMoreViewItem: (key: string) => TViewItem;
    /** Build the VS Code tree item for a "Load More" node. */
    readonly getTreeItem: (parentViewItem: TViewItem, loading: boolean) => ITreeItem;
}

const loadMoreSuffix = '/~loadMore';

/**
 * Creates a default {@linkcode LoadMoreOptions} implementation using a
 * suffix-based key convention. The "Load More" view item for a parent
 * with key `'foo'` will have key `'foo/~loadMore'`.
 *
 * Callers provide a {@linkcode LoadMoreAdapter} to bridge between the
 * generic key strings and their concrete view item type.
 */
export function createDefaultLoadMoreOptions<TViewItem>(adapter: LoadMoreAdapter<TViewItem>): LoadMoreOptions<TViewItem> {
    return {
        isLoadMoreKey: key => key.endsWith(loadMoreSuffix),
        getLoadMoreKey: parentKey => parentKey + loadMoreSuffix,
        getParentKey: loadMoreKey => loadMoreKey.slice(0, -loadMoreSuffix.length),
        createLoadMoreViewItem: adapter.createLoadMoreViewItem,
        getTreeItem: adapter.getTreeItem,
    };
}

/**
 * A view-layer tree built on top of a {@linkcode DataItemTree}.
 *
 * Registered {@linkcode ViewProvider}s control how resources are presented:
 * they may inject virtual nodes (nodes that do not exist in the underlying
 * {@linkcode DataItemTree}), filter, group, sort, or otherwise transform the
 * children returned for each resource -- without modifying the data layer.
 *
 * Parent relationships are tracked internally so that
 * {@linkcode getParent} works for both real and virtual nodes.
 *
 * @typeParam TViewItem - The view item type stored in the tree.
 * @typeParam TResource - The resource type stored in the underlying {@linkcode DataItemTree}.
 */
export class ViewItemTree<TViewItem, TResource> extends ProviderRegistry<TViewItem, ViewProvider<TViewItem>> implements vscode.TreeDataProvider<TViewItem>, Disposable {
    /** Map from key to node for O(1) lookup. */
    private readonly nodes = new NodeMap<ViewNode<TViewItem>>(node => this.getKey(node.viewItem));

    /** Deduplicates concurrent loadMore calls per parent key. */
    private readonly loadsInFlight = new InflightMap<void>();

    /** Cached root nodes. */
    private roots: ViewNode<TViewItem>[] | undefined;

    /** Subscription to the underlying {@linkcode DataItemTree}'s change event. */
    private readonly dataItemTreeSubscription: Disposable;

    public readonly onDidChangeTreeData = this.changeEmitter.event;

    private readonly getKey: (viewItem: TViewItem) => string;
    private readonly getResourceKey: (viewItem: TViewItem) => string;
    private readonly hasMoreData: (key: string) => boolean;
    private readonly loadMoreData: (key: string) => Promise<void>;

    /**
     * @param name - A short identifier for this tree instance (e.g.
     *   `'resources'`, `'activity'`). Stamped on every telemetry event as
     *   `properties.tree`.
     * @param executor - The {@linkcode IActionExecutor} to use for telemetry and error handling when calling view providers.
     * @param options - Configuration for the view item tree.
     * @param loadMoreOptions - Optional. When provided, enables automatic "Load More" node
     * injection for paginated branches.
     */
    public constructor(
        private readonly name: string,
        private readonly executor: IActionExecutor,
        options: ViewItemTreeOptions<TViewItem, TResource>,
        private readonly loadMoreOptions?: LoadMoreOptions<TViewItem>,
        private readonly output?: IOutputChannel,
    ) {
        super();

        this.getKey = options.getKey;
        this.getResourceKey = options.getResourceKey;
        this.hasMoreData = key => {
            const resource = options.dataItemTree.get(key);
            return resource ? options.dataItemTree.hasMore(resource) : false;
        };
        this.loadMoreData = key => {
            const resource = options.dataItemTree.get(key);
            return resource ? options.dataItemTree.loadMore(resource) : Promise.resolve();
        };

        // Forward data-layer changes so the view refreshes automatically.
        // If the changed resource maps to a view item that is NOT in the
        // view tree (e.g. a skipped account/tenant node), fall back to a
        // full refresh so the tree still picks up the structural change.
        this.dataItemTreeSubscription = options.dataItemTree.onDidChange(resource => {
            if (resource !== undefined) {
                const viewItem = options.toViewItem(resource);
                const node = this.nodes.get(this.getKey(viewItem));
                if (node) {
                    // Fire with the original `ViewItem`
                    this.changeEmitter.fire(node.viewItem);
                    return;
                }
            }

            this.changeEmitter.fire(undefined);
        });
    }

    /**
     * Get children for the given resource, or root-level resources when
     * called with `undefined` -- mirroring `TreeDataProvider.getChildren`.
     *
     * Delegates to registered {@linkcode ViewProvider}s, which may inject virtual
     * nodes, filter, reorder, or group the results as they see fit.
     */
    public async getChildren(viewItem?: TViewItem): Promise<TViewItem[]> {
        if (viewItem === undefined) {
            this.output?.trace('[view] %s getChildren(root)', this.name);
            return this.getRootChildren();
        }

        this.output?.trace('[view] %s getChildren key=%s', this.name, this.getKey(viewItem));
        return this.getBranchChildren(viewItem);
    }

    private async getRootChildren(): Promise<TViewItem[]> {
        this.output?.trace('[view] %s dispatch getRootChildren providers=%d', this.name, this.getRootProviders().length);
        // TODO: concurrency limits
        // Each root provider gets its own telemetry scope so that
        // concurrent calls don't overwrite shared mutable properties.
        const results = await Promise.all(
            this.getRootProviders()
                .map(async p => this.executor.callWithTelemetryAndErrorHandling('view.getRootChildren', (context) => {
                    context.telemetry.suppress = 'onSuccess';
                    context.errorHandling.rethrow = true;
                    context.telemetry.properties.tree = this.name;
                    context.telemetry.properties.provider = p.constructor.name;
                    return Promise.resolve(p.getChildren());
                })),
        );
        const viewItems = results.flatMap(r => r ?? []);

        // Evict the old root subtree and build new root nodes
        this.nodes.removeSubtrees(this.roots);
        this.roots = viewItems.map(viewItem => {
            const node: ViewNode<TViewItem> = { viewItem, parent: undefined, children: undefined };
            this.nodes.set(this.getKey(viewItem), node);
            return node;
        });

        return viewItems;
    }

    private async getBranchChildren(viewItem: TViewItem): Promise<TViewItem[]> {
        this.output?.trace('[view] %s dispatch getBranchChildren key=%s', this.name, this.getKey(viewItem));
        const parentNode = this.nodes.get(this.getKey(viewItem));
        if (!parentNode) {
            return [];
        }

        const provider = this.findProvider(viewItem);
        if (!provider) {
            this.nodes.removeSubtrees(parentNode.children);
            parentNode.children = [];
            return [];
        }

        const childItems = await this.executor.callWithTelemetryAndErrorHandling('view.getBranchChildren', (context) => {
            context.telemetry.suppress = 'onSuccess';
            context.errorHandling.rethrow = true;
            context.telemetry.properties.tree = this.name;
            context.telemetry.properties.provider = provider.constructor.name;
            return provider.getChildren(viewItem);
        }) ?? [];

        // Evict old children subtrees and build new child nodes
        this.nodes.removeSubtrees(parentNode.children);
        parentNode.children = childItems.map(child => {
            const node: ViewNode<TViewItem> = { viewItem: child, parent: parentNode, children: undefined };
            this.nodes.set(this.getKey(child), node);
            return node;
        });

        // Inject a synthetic "Load More" view item if the data layer has
        // more pages and load-more support is configured.
        // The load-more key is derived from the view key (not the resource
        // key) so that getParentKey returns the view key used by this.nodes.
        const resourceKey = this.getResourceKey(viewItem);
        if (this.loadMoreOptions && this.hasMoreData(resourceKey)) {
            const viewKey = this.getKey(viewItem);
            const loadMoreKey = this.loadMoreOptions.getLoadMoreKey(viewKey);
            this.output?.debug('[view] %s inject loadMore parent=%s key=%s', this.name, viewKey, loadMoreKey);
            return [...childItems, this.loadMoreOptions.createLoadMoreViewItem(loadMoreKey)];
        }
        this.output?.debug('[view] %s no loadMore injection key=%s', this.name, this.getKey(viewItem));

        return childItems;
    }

    /**
     * Get the VS Code tree item representation for the given resource by
     * delegating to the {@linkcode ViewProvider} that handles it.
     */
    public async getTreeItem(viewItem: TViewItem): Promise<ITreeItem> {
        this.output?.trace('[view] %s dispatch getTreeItem key=%s', this.name, this.getKey(viewItem));
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- The result will be defined (or an error rethrown)
        return (await this.executor.callWithTelemetryAndErrorHandling('view.getTreeItem', (context) => {
            context.telemetry.suppress = 'onSuccess';
            context.telemetry.isUserEvent = false;
            context.errorHandling.rethrow = true;
            context.telemetry.properties.tree = this.name;

            // Synthetic "Load More" nodes: return the configured tree item directly (no provider involved)
            const key = this.getKey(viewItem);
            if (this.loadMoreOptions?.isLoadMoreKey(key)) {
                const parentKey = this.loadMoreOptions.getParentKey(key);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Parent is guaranteed to be cached; Load More nodes are only injected as children of cached branch nodes.
                const parentViewItem = this.nodes.get(parentKey)!.viewItem;
                return this.loadMoreOptions.getTreeItem(parentViewItem, this.loadsInFlight.has(parentKey));
            }

            const provider = this.findProvider(viewItem);
            if (!provider) {
                throw new Error(`No view provider found for view item: ${this.getKey(viewItem)}`);
            }
            context.telemetry.properties.provider = provider.constructor.name;
            return provider.getTreeItem(viewItem);
        }))!;
    }

    /**
     * Get the parent of a view item, or `undefined` if it is a root item.
     *
     * Uses the cached node map for nodes that have been loaded via
     * {@linkcode getChildren}. Falls back to the owning {@linkcode ViewProvider}'s
     * `getParent` method (if implemented) so that `TreeView.reveal()`
     * works for nodes that have not yet been loaded.
     */
    public async getParent(viewItem: TViewItem): Promise<TViewItem | undefined> {
        this.output?.trace('[view] %s dispatch getParent key=%s', this.name, this.getKey(viewItem));
        return await this.executor.callWithTelemetryAndErrorHandling('view.getParent', async (context) => {
            context.telemetry.suppress = 'onSuccess';
            context.telemetry.isUserEvent = false;
            context.errorHandling.rethrow = true;
            context.telemetry.properties.tree = this.name;

            // Synthetic "Load More" nodes: derive the parent from the cached node map
            const key = this.getKey(viewItem);
            if (this.loadMoreOptions?.isLoadMoreKey(key)) {
                const parentKey = this.loadMoreOptions.getParentKey(key);
                return this.nodes.get(parentKey)?.viewItem;
            }

            // Fast path: node is already in the map from a prior getChildren() call.
            // We must distinguish "not in cache" from "in cache with no parent"
            // (root nodes), so we check the node itself rather than its parent.
            const node = this.nodes.get(this.getKey(viewItem));
            if (node) {
                return node.parent?.viewItem;
            }

            // Slow path: ask the provider to compute the parent on demand
            const provider = this.findProvider(viewItem);
            if (provider) {
                context.telemetry.properties.provider = provider.constructor.name;
            }
            return await provider?.getParent?.(viewItem) ?? undefined;
        });
    }

    /**
     * Trigger the data layer to pull the next page.
     *
     * Accepts either a "Load More" view item (from which the parent key is
     * derived via {@linkcode LoadMoreOptions.getParentKey}) or a direct
     * parent view item.
     *
     * The data tree fires {@linkcode DataItemTree.onDidChange} which
     * automatically refreshes the view, causing the new children (and
     * possibly a new "Load More" node) to appear.
     */
    public async loadMore(viewItem: TViewItem): Promise<void> {
        const viewItemKey = this.getKey(viewItem);
        const parentKey = this.loadMoreOptions?.isLoadMoreKey(viewItemKey)
            ? this.loadMoreOptions.getParentKey(viewItemKey)
            : viewItemKey;

        // The parent is guaranteed to be in the cache because Load More
        // nodes are only injected as children of cached branch nodes.
        const parentNode = this.nodes.get(parentKey);
        if (!parentNode) {
            throw new Error(`loadMore: parent node not found in cache for key: ${parentKey}`);
        }

        await this.loadsInFlight.getOrRun(parentKey, async () => {
            // Re-render the "Load More" node with a spinner / disabled command
            this.changeEmitter.fire(parentNode.viewItem);

            try {
                const resourceKey = this.getResourceKey(parentNode.viewItem);
                await this.loadMoreData(resourceKey);
            } finally {
                // Ensure the parent subtree is re-rendered after loading completes
                this.changeEmitter.fire(parentNode.viewItem);
            }
        });
    }

    public override dispose(): void {
        this.dataItemTreeSubscription.dispose();
        super.dispose();
    }

    protected override onProviderChanged(_event: DataProviderChangeEvent<TViewItem>): void {
        if (this.roots) {
            this.nodes.removeSubtrees(this.roots);
        }
        this.roots = undefined;
        this.changeEmitter.fire(undefined);
    }
}

/**
 * Internal node wrapping a view item with its cached children and parent.
 * @internal
 */
interface ViewNode<T> {
    readonly viewItem: T;
    readonly parent: ViewNode<T> | undefined;
    children: ViewNode<T>[] | undefined; // undefined = not yet loaded
}
