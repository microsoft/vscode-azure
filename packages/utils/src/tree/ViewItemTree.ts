/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import type { Disposable } from '../vscode/Disposable';
import type { ITreeItem } from '../vscode/IVsCode';
import type { ProviderResult } from '../vscode/ProviderResult';
import { NodeMap } from './NodeMap';
import { ProviderRegistry } from './ProviderRegistry';
import type { DataItemTree } from './DataItemTree';
import type { ViewProvider } from './ViewProvider';

/**
 * Internal node wrapping a view item with its cached children and parent.
 * @internal
 */
interface ViewNode<T> {
    readonly viewItem: T;
    readonly parent: ViewNode<T> | undefined;
    children: ViewNode<T>[] | undefined; // undefined = not yet loaded
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

    /** Cached root nodes. */
    private roots: ViewNode<TViewItem>[] | undefined;

    /** Subscription to the underlying {@link DataItemTree}'s change event. */
    private readonly dataItemTreeSubscription: Disposable;

    public readonly onDidChangeTreeData = this.changeEmitter.event;

    /**
     * @param dataItemTree - The underlying data-layer tree (read-only).
     * @param toViewItem - Converts a resource to a view item.
     * @param getKey - Extracts a unique string key from a view item.
     */
    public constructor(
        dataItemTree: DataItemTree<TResource>,
        toViewItem: (resource: TResource) => TViewItem,
        private readonly getKey: (viewItem: TViewItem) => string
    ) {
        super();

        // Forward data-layer changes so the view refreshes automatically.
        // If the changed resource maps to a view item that is NOT in the
        // view tree (e.g. a skipped account/tenant node), fall back to a
        // full refresh so the tree still picks up the structural change.
        this.dataItemTreeSubscription = dataItemTree.onDidChange(resource => {
            if (resource !== undefined) {
                const viewItem = toViewItem(resource);
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
     * called with `undefined` - mirroring `TreeDataProvider.getChildren`.
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
        const results = await Promise.all(
            this.getRootProviders()
                .map(p => Promise.resolve(p.getChildren())),
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

        const childItems = await provider.getChildren(viewItem) ?? [];

        // Evict old children subtrees and build new child nodes
        this.nodes.removeSubtrees(parentNode.children);
        parentNode.children = childItems.map(child => {
            const node: ViewNode<TViewItem> = { viewItem: child, parent: parentNode, children: undefined };
            this.nodes.set(this.getKey(child), node);
            return node;
        });

        return childItems;
    }

    /**
     * Get the VS Code tree item representation for the given resource by
     * delegating to the {@link ViewProvider} that handles it.
     */
    public getTreeItem(viewItem: TViewItem): ITreeItem | Promise<ITreeItem> {
        const provider = this.findProvider(viewItem);
        if (!provider) {
            throw new Error(`No view provider found for view item: ${this.getKey(viewItem)}`);
        }
        return provider.getTreeItem(viewItem);
    }

    /**
     * Get the parent of a view item, or `undefined` if it is a root item.
     *
     * Uses the cached node map for nodes that have been loaded via
     * {@link getChildren}. Falls back to the owning {@link ViewProvider}'s
     * `getParent` method (if implemented) so that `TreeView.reveal()`
     * works for nodes that have not yet been loaded.
     */
    public getParent(viewItem: TViewItem): ProviderResult<TViewItem | undefined> {
        // Fast path: node is already in the map from a prior getChildren() call.
        // We must distinguish "not in cache" from "in cache with no parent"
        // (root nodes), so we check the node itself rather than its parent.
        const node = this.nodes.get(this.getKey(viewItem));
        if (node) {
            return node.parent?.viewItem;
        }

        // Slow path: ask the provider to compute the parent on demand
        const provider = this.findProvider(viewItem);
        return provider?.getParent?.(viewItem);
    }

    public override dispose(): void {
        this.dataItemTreeSubscription.dispose();
        super.dispose();
    }
}
