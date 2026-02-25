/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import type { Disposable } from '../vscode/Disposable';
import { NodeMap } from './NodeMap';
import { ProviderRegistry } from './ProviderRegistry';
import type { ResourceTree } from './ResourceTree';
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
 * A view-layer tree built on top of a {@link ResourceTree}.
 *
 * Registered {@link ViewProvider}s control how resources are presented:
 * they may inject virtual nodes (nodes that do not exist in the underlying
 * {@link ResourceTree}), filter, group, sort, or otherwise transform the
 * children returned for each resource -- without modifying the data layer.
 *
 * Parent relationships are tracked internally so that
 * {@link getParent} works for both real and virtual nodes.
 *
 * @typeParam TViewItem - The view item type stored in the tree.
 * @typeParam TResource - The resource type stored in the underlying {@link ResourceTree}.
 */
export class ViewItemTree<TViewItem, TResource> extends ProviderRegistry<TViewItem, ViewProvider<TViewItem>> implements vscode.TreeDataProvider<TViewItem> {
    /** Map from key to node for O(1) lookup. */
    private readonly nodes = new NodeMap<ViewNode<TViewItem>>(node => this.getKey(node.viewItem));

    /** Cached root nodes. */
    private roots: ViewNode<TViewItem>[] | undefined;

    /** Subscription to the underlying {@link ResourceTree}'s change event. */
    private readonly resourceTreeSubscription: Disposable;

    public readonly onDidChangeTreeData = this.changeEmitter.event;

    /**
     * @param resourceTree - The underlying data-layer tree (read-only).
     * @param toViewItem - Converts a resource to a view item.
     * @param getKey - Extracts a unique string key from a view item.
     */
    public constructor(
        resourceTree: ResourceTree<TResource>,
        toViewItem: (resource: TResource) => TViewItem,
        private readonly getKey: (viewItem: TViewItem) => string
    ) {
        super();

        // Forward data-layer changes so the view refreshes automatically.
        // If the changed resource maps to a view item that is NOT in the
        // view tree (e.g. a skipped account/tenant node), fall back to a
        // full refresh so the tree still picks up the structural change.
        this.resourceTreeSubscription = resourceTree.onDidChange(resource => {
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
    public getTreeItem(viewItem: TViewItem): vscode.TreeItem | Promise<vscode.TreeItem> {
        const provider = this.findProvider(viewItem);
        if (!provider) {
            throw new Error(`No view provider found for view item: ${this.getKey(viewItem)}`);
        }
        return provider.getTreeItem(viewItem);
    }

    /**
     * Get the parent of a view item, or `undefined` if it is a root item
     * or has not yet been loaded into the view tree.
     */
    public getParent(viewItem: TViewItem): TViewItem | undefined {
        return this.nodes.get(this.getKey(viewItem))?.parent?.viewItem;
    }

    public override dispose(): void {
        this.resourceTreeSubscription.dispose();
        super.dispose();
    }
}
