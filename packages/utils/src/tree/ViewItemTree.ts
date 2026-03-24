/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import type { IActionExecutor } from '../base/IActionExecutor';
import { InflightMap } from '../data/InflightMap';
import type { Disposable } from '../vscode/Disposable';
import type { ITreeItem } from '../vscode/IVsCode';
import type { DataItemTree } from './DataItemTree';
import { NodeMap } from './NodeMap';
import { ProviderRegistry } from './ProviderRegistry';
import type { ViewProvider } from './ViewProvider';

/**
 * Options for constructing a {@link ViewItemTree}.
 *
 * @typeParam TViewItem - The view item type stored in the tree.
 * @typeParam TResource - The resource type stored in the underlying {@link DataItemTree}.
 */
export interface ViewItemTreeOptions<TViewItem, TResource> {
    readonly dataItemTree: DataItemTree<TResource>;
    readonly toViewItem: (resource: TResource) => TViewItem;
    readonly getKey: (viewItem: TViewItem) => string;
    readonly getResourceKey: (viewItem: TViewItem) => string;
}

/**
 * Optional configuration for "Load More" support.
 *
 * When provided, the tree automatically appends a synthetic "Load More"
 * view item to any branch whose data-layer provider has more pages.
 *
 * @typeParam TViewItem - The view item type stored in the tree.
 */
export interface LoadMoreOptions<TViewItem> {
    /**
     * Test whether a view item is a synthetic "Load More" node.
     */
    readonly isLoadMoreViewItem: (viewItem: TViewItem) => boolean;

    /**
     * Derive the "Load More" view item for a given parent.
     * The returned view item must satisfy {@link isLoadMoreViewItem}.
     */
    readonly getLoadMoreViewItem: (parentKey: string) => TViewItem;

    /**
     * Derive the parent view item from a "Load More" view item.
     * Inverse of {@link getLoadMoreViewItem}.
     */
    readonly getParentViewItem: (loadMoreViewItem: TViewItem) => TViewItem;

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
 * Adapters for mapping between view items and string keys,
 * used by {@link createDefaultLoadMoreOptions}.
 */
export interface LoadMoreAdapter<TViewItem> {
    /** Create a view item from its key. */
    readonly createViewItem: (key: string) => TViewItem;
    /** Extract the key from a view item. */
    readonly getKey: (viewItem: TViewItem) => string;
    /** Build the VS Code tree item for a "Load More" node. */
    readonly getTreeItem: (parentViewItem: TViewItem, loading: boolean) => ITreeItem;
}

const loadMoreSuffix = '/~loadMore';

/**
 * Creates a default {@link LoadMoreOptions} implementation using a
 * suffix-based key convention. The "Load More" view item for a parent
 * with key `'foo'` will have key `'foo/~loadMore'`.
 *
 * Callers provide a {@link LoadMoreAdapter} to bridge between the
 * generic key strings and their concrete view item type.
 */
export function createDefaultLoadMoreOptions<TViewItem>(adapter: LoadMoreAdapter<TViewItem>): LoadMoreOptions<TViewItem> {
    return {
        isLoadMoreViewItem: vi => adapter.getKey(vi).endsWith(loadMoreSuffix),
        getLoadMoreViewItem: parentKey => adapter.createViewItem(parentKey + loadMoreSuffix),
        getParentViewItem: vi => adapter.createViewItem(adapter.getKey(vi).slice(0, -loadMoreSuffix.length)),
        getTreeItem: adapter.getTreeItem,
    };
}

/**
 * A view-layer tree built on top of a {@link DataItemTree}.
 *
 * Registered {@link ViewProvider}s control how resources are presented:
 * they may inject virtual nodes (nodes that do not exist in the underlying
 * {@link DataItemTree}), filter, group, sort, or otherwise transform the
 * children returned for each resource -- without modifying the data layer.
 *
 * Parent relationships are tracked internally so that
 * {@link getParent} works for both real and virtual nodes.
 *
 * @typeParam TViewItem - The view item type stored in the tree.
 * @typeParam TResource - The resource type stored in the underlying {@link DataItemTree}.
 */
export class ViewItemTree<TViewItem, TResource> extends ProviderRegistry<TViewItem, ViewProvider<TViewItem>> implements vscode.TreeDataProvider<TViewItem> {
    /** Map from key to node for O(1) lookup. */
    private readonly nodes = new NodeMap<ViewNode<TViewItem>>(node => this.getKey(node.viewItem));

    /** Deduplicates concurrent loadMore calls per parent key. */
    private readonly loadsInFlight = new InflightMap<void>();

    /** Cached root nodes. */
    private roots: ViewNode<TViewItem>[] | undefined;

    /** Subscription to the underlying {@link DataItemTree}'s change event. */
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
     * @param executor - The {@link IActionExecutor} to use for telemetry and error handling when calling view providers.
     * @param options - Configuration for the view item tree.
     * @param loadMoreOptions - Optional. When provided, enables automatic "Load More" node
     * injection for paginated branches.
     */
    public constructor(
        private readonly name: string,
        private readonly executor: IActionExecutor,
        options: ViewItemTreeOptions<TViewItem, TResource>,
        private readonly loadMoreOptions?: LoadMoreOptions<TViewItem>,
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
     * Delegates to registered {@link ViewProvider}s, which may inject virtual
     * nodes, filter, reorder, or group the results as they see fit.
     */
    public async getChildren(viewItem?: TViewItem): Promise<TViewItem[]> {
        if (viewItem === undefined) {
            return this.getRootChildren();
        }

        return this.getBranchChildren(viewItem);
    }

    private async getRootChildren(): Promise<TViewItem[]> {
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
        const resourceKey = this.getResourceKey(viewItem);
        if (this.loadMoreOptions && this.hasMoreData(resourceKey)) {
            return [...childItems, this.loadMoreOptions.getLoadMoreViewItem(resourceKey)];
        }

        return childItems;
    }

    /**
     * Get the VS Code tree item representation for the given resource by
     * delegating to the {@link ViewProvider} that handles it.
     */
    public async getTreeItem(viewItem: TViewItem): Promise<ITreeItem> {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- The result will be defined (or an error rethrown)
        return (await this.executor.callWithTelemetryAndErrorHandling('view.getTreeItem', (context) => {
            context.telemetry.suppress = 'onSuccess';
            context.telemetry.isUserEvent = false;
            context.errorHandling.rethrow = true;
            context.telemetry.properties.tree = this.name;

            // Synthetic "Load More" nodes: return the configured tree item directly (no provider involved)
            if (this.loadMoreOptions?.isLoadMoreViewItem(viewItem)) {
                const parentViewItem = this.loadMoreOptions.getParentViewItem(viewItem);
                const parentKey = this.getKey(parentViewItem);
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
     * {@link getChildren}. Falls back to the owning {@link ViewProvider}'s
     * `getParent` method (if implemented) so that `TreeView.reveal()`
     * works for nodes that have not yet been loaded.
     */
    public async getParent(viewItem: TViewItem): Promise<TViewItem | undefined> {
        return await this.executor.callWithTelemetryAndErrorHandling('view.getParent', async (context) => {
            context.telemetry.suppress = 'onSuccess';
            context.telemetry.isUserEvent = false;
            context.errorHandling.rethrow = true;
            context.telemetry.properties.tree = this.name;

            // Synthetic "Load More" nodes: derive the parent directly from the view item (no cache lookup or provider involved)
            if (this.loadMoreOptions?.isLoadMoreViewItem(viewItem)) {
                return this.loadMoreOptions.getParentViewItem(viewItem);
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
     * Accepts either a "Load More" view item (from which the parent is
     * derived via {@link LoadMoreOptions.getParentViewItem}) or a direct
     * parent view item.
     *
     * The data tree fires {@link DataItemTree.onDidChange} which
     * automatically refreshes the view, causing the new children (and
     * possibly a new "Load More" node) to appear.
     */
    public async loadMore(viewItem: TViewItem): Promise<void> {
        const parentViewItem = this.loadMoreOptions?.isLoadMoreViewItem(viewItem)
            ? this.loadMoreOptions.getParentViewItem(viewItem)
            : viewItem;

        const parentKey = this.getKey(parentViewItem);

        await this.loadsInFlight.getOrRun(parentKey, async () => {
            // Re-render the "Load More" node with a spinner / disabled command
            this.changeEmitter.fire(parentViewItem);

            try {
                await this.loadMoreData(this.getResourceKey(parentViewItem));
            } finally {
                // Ensure the parent subtree is re-rendered after loading completes
                this.changeEmitter.fire(parentViewItem);
            }
        });
    }

    public override dispose(): void {
        this.dataItemTreeSubscription.dispose();
        super.dispose();
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
