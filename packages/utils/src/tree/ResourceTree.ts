/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IVsCode } from '../base/IVsCode';
import type { Disposable } from '../types/Disposable';
import type { DataProvider } from './DataProvider';

/**
 * Internal node wrapping a resource with its cached children and staleness info.
 */
interface TreeNode<T> {
    readonly resource: T;
    readonly parent: T | undefined;      // undefined = root node
    children: T[] | undefined;  // undefined = not yet loaded
    staleAt: number;            // Date.now() after which children should be re-fetched
}

/** A registered provider with its options. */
interface RegisteredProvider<T> {
    readonly provider: DataProvider<T>;
    readonly root: boolean;
}

/**
 * Options for registering a {@link DataProvider} with a {@link ResourceTree}.
 */
export interface RegisterProviderOptions {
    /** If true, this provider will be called with no argument to produce root items. */
    root?: boolean;
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
export class ResourceTree<T> implements Disposable {
    private readonly nodes = new Map<string, TreeNode<T>>();
    private readonly registrations: RegisteredProvider<T>[] = [];
    private readonly changeEmitter;

    /** Cached root nodes and their staleness timestamp. */
    private roots: TreeNode<T>[] | undefined;
    private rootsStaleAt: number = 0;

    /** Fires when part of the tree has been invalidated. */
    public readonly onDidChange;

    /**
     * @param code - The VS Code API (for EventEmitter).
     * @param getKey - Extracts a unique string key from a resource.
     * @param ttl - Time-to-live in milliseconds for cached children.
     */
    public constructor(
        code: IVsCode,
        private readonly getKey: (resource: T) => string,
        private readonly ttl: number,
    ) {
        this.changeEmitter = new code.EventEmitter<T | undefined>();
        this.onDidChange = this.changeEmitter.event;
    }

    /**
     * Register a {@link DataProvider}. Returns a {@link Disposable} that
     * unregisters the provider when disposed.
     *
     * @param options - Registration options
     */
    public registerProvider(provider: DataProvider<T>, options?: RegisterProviderOptions): Disposable {
        const entry: RegisteredProvider<T> = { provider, root: !!options?.root };
        this.registrations.push(entry);
        return {
            dispose: () => {
                const idx = this.registrations.indexOf(entry);
                if (idx !== -1) {
                    this.registrations.splice(idx, 1);
                }
            },
        };
    }

    /**
     * Get children for the given resource, or the root-level resources when
     * called with `undefined` — mirroring VSCode's `TreeDataProvider.getChildren`.
     *
     * Results are lazily loaded and cached with TTL.
     */
    public async getChildren(resource?: T): Promise<T[]> {
        if (resource === undefined) {
            return this.getRoots();
        }

        return this.getBranchChildren(resource);
    }

    private async getRoots(): Promise<T[]> {
        if (this.roots !== undefined && Date.now() < this.rootsStaleAt) {
            return this.roots.map(n => n.resource);
        }

        // Clear all cached nodes when recomputing roots since the whole tree may have changed
        this.nodes.clear();

        const results = await Promise.all(
            this.registrations
                .filter(r => r.root)
                .map(r => Promise.resolve(r.provider.getChildren())),
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
            return node.children;
        }

        // Find the provider that handles this resource
        const entry = this.registrations.find(r => r.provider.canHandle(resource));
        if (!entry) {
            node.children = [];
            node.staleAt = Date.now() + this.ttl;
            return [];
        }

        // Remove previously cached children that may no longer be present
        if (node.children !== undefined) {
            for (const child of node.children) {
                this.nodes.delete(this.getKey(child));
            }
        }

        const children = await entry.provider.getChildren(resource) ?? [];

        for (const child of children) {
            this.nodes.set(this.getKey(child), { resource: child, parent: resource, children: undefined, staleAt: 0 });
        }

        node.children = children;
        node.staleAt = Date.now() + this.ttl;

        this.enrichAll(children);

        return children;
    }

    /**
     * For each resource, find the provider that handles it and call
     * {@link DataProvider.enrich enrich} if present. Enrichment runs in the
     * background - each resolved call fires {@link onDidChange} for that resource.
     */
    private enrichAll(resources: T[]): void {
        for (const resource of resources) {
            for (const { provider } of this.registrations) {
                if (provider.canHandle(resource) && provider.enrich) {
                    Promise
                        .resolve(provider.enrich(resource))
                        .then(() => { this.changeEmitter.fire(resource); })
                        .catch(() => { /* TODO: ignore enrichment errors? */ });
                    break;
                }
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
        return this.nodes.get(this.getKey(resource))?.parent;
    }

    /**
     * Invalidate a specific resource's cached children, removing them from
     * the tree. They will be re-fetched on next access.
     * Fires {@link onDidChange}.
     */
    public invalidate(resource: T): void {
        const node = this.nodes.get(this.getKey(resource));
        if (node?.children) {
            for (const child of node.children) {
                this.nodes.delete(this.getKey(child));
            }
            node.children = undefined;
            node.staleAt = 0;
        }
        this.changeEmitter.fire(resource);
    }

    /**
     * Invalidate all cached data. Clears the entire node map and root cache.
     * Fires {@link onDidChange} once with `undefined` (full refresh).
     */
    public invalidateAll(): void {
        this.nodes.clear();
        this.roots = undefined;
        this.rootsStaleAt = 0;
        this.changeEmitter.fire(undefined);
    }

    /**
     * Dispose the change-notification emitter.
     */
    public dispose(): void {
        this.changeEmitter.dispose();
    }
}
