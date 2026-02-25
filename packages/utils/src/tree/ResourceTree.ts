/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DataProvider } from './DataProvider';
import { NodeMap } from './NodeMap';
import { ProviderRegistry } from './ProviderRegistry';

/**
 * Internal node wrapping a resource with its cached children and staleness info.
 * @internal
 */
interface TreeNode<T> {
    readonly resource: T;
    readonly parent: TreeNode<T> | undefined;      // undefined = root node
    children: TreeNode<T>[] | undefined;  // undefined = not yet loaded
    staleAt: number;            // Date.now() after which children should be re-fetched
}

/**
 * A lazily-loaded, cached tree of resources built up piecewise by
 * {@link DataProvider}s.
 *
 * Each node's children are loaded on first access and cached until stale.
 * The tree is the single source of truth for the data layer -- the
 * `TreeDataProvider`s are view-only and read from it.
 *
 * TODO: add tests
 *
 * @typeParam T - The resource type stored in the tree.
 */
export class ResourceTree<T> extends ProviderRegistry<T, DataProvider<T>> {
    private readonly nodes = new NodeMap<TreeNode<T>>(node => this.getKey(node.resource));

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
        const resources = results.flatMap((r) => r ?? []);

        this.roots = resources.map(resource => {
            const node: TreeNode<T> = { resource, parent: undefined, children: undefined, staleAt: 0 };
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

        const children = await provider.getChildren(resource) ?? [];

        node.children = children.map(child => {
            const childNode: TreeNode<T> = { resource: child, parent: node, children: undefined, staleAt: 0 };
            this.nodes.set(this.getKey(child), childNode);
            return childNode;
        });
        node.staleAt = Date.now() + this.ttl;

        this.enrichAll(children);

        return children;
    }

    /**
     * For each resource, find the provider that handles it and call
     * {@link DataProvider.enrich enrich} if present. Enrichment runs in the
     * background - each resolved call fires {@link onDidChangeTreeData} for that resource.
     */
    private enrichAll(resources: T[]): void {
        // TODO: concurrency limits
        for (const resource of resources) {
            const provider = this.findProvider(resource);
            if (provider?.enrich) {
                Promise
                    .resolve(provider.enrich(resource))
                    .then(() => { this.changeEmitter.fire(resource); })
                    .catch(() => { /* TODO: ignore enrichment errors? */ });
            }
        }
    }

    /**
     * Get a resource by key from the tree, if it has been loaded.
     */
    public get(key: string): T | undefined {
        return this.nodes.get(key)?.resource;
    }

    /**
     * Get the parent of a resource, or `undefined` if it is a root node
     * or has not yet been loaded into the tree.
     */
    public getParent(resource: T): T | undefined {
        return this.nodes.get(this.getKey(resource))?.parent?.resource;
    }

    /**
     * Invalidate a specific resource's cached children, removing them from
     * the tree. They will be re-fetched on next access.
     * Fires {@link onDidChangeTreeData}.
     */
    public invalidate(resource: T): void {
        const node = this.nodes.get(this.getKey(resource));
        if (node) {
            this.nodes.removeSubtrees(node.children);
            node.children = undefined;
            node.staleAt = 0;
        }
        this.changeEmitter.fire(resource);
    }

    /**
     * Invalidate all cached data. Clears the entire node map and root cache.
     * Fires {@link onDidChangeTreeData} once with `undefined` (full refresh).
     */
    public invalidateAll(): void {
        this.nodes.clear();
        this.roots = undefined;
        this.rootsStaleAt = 0;
        this.changeEmitter.fire(undefined);
    }
}
