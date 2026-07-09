/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The pure, synchronous *hierarchy* half of {@linkcode DataItemTree}.
 *
 * A tree's children lists, their staleness, and in-flight de-duplication are
 * delegated to a flat cache (`@tanstack/query-core`). That cache stores lists
 * under opaque query keys and knows nothing about parent/child relationships.
 * {@linkcode TreeIndex} supplies the tree *meaning* the cache lacks: it records,
 * for every loaded node, both the resource and its **path** (the chain of keys
 * from a root down to the node, inclusive), and answers the structural questions
 * the orchestrator needs -- who are a node's direct children, its descendants,
 * its parent, and which of a matched set are *apexes* (have no matched
 * ancestor).
 *
 * It holds no cache, no async, and no VS Code dependency, so it is trivially
 * unit-testable in isolation. It is a *mechanism*: it never evicts from the
 * cache, fires events, or fetches -- {@linkcode DataItemTree} owns that policy
 * and calls into this index to keep the two halves consistent (every cached
 * path corresponds to an indexed node and vice versa).
 *
 * A node's path is its parent's path plus its own key, so descendant / prefix
 * relationships are decided purely by comparing paths -- no separate child
 * pointers are stored.
 *
 * @typeParam T - The data item type stored in the tree.
 * @internal
 */
export class TreeIndex<T> {
    /** Flat key -> resource, populated as children/roots are indexed. */
    private readonly index = new Map<string, T>();

    /** Flat key -> path (root -> node, inclusive): the recovered hierarchy. */
    private readonly paths = new Map<string, readonly string[]>();

    /**
     * @param getKey - Extracts a unique string key from a resource. The same
     *   function {@linkcode DataItemTree} uses, so keys line up across the two
     *   halves.
     */
    public constructor(
        private readonly getKey: (resource: T) => string,
    ) { }

    /** Get a loaded resource by key, or `undefined` if it is not indexed. */
    public get(key: string): T | undefined {
        return this.index.get(key);
    }

    /** Whether a node with the given key is currently indexed. */
    public has(key: string): boolean {
        return this.index.has(key);
    }

    /** The path (root -> node, inclusive) of a key, or `undefined` if unknown. */
    public pathOf(key: string): readonly string[] | undefined {
        return this.paths.get(key);
    }

    /** Iterate the `[key, resource]` pairs of every indexed node. */
    public entries(): IterableIterator<[string, T]> {
        return this.index.entries();
    }

    /**
     * Index (add or overwrite) a set of children under a parent path. Each
     * child's path becomes `[...parentPath, childKey]`. Does not evict anything;
     * the caller reconciles departed children separately.
     */
    public indexChildren(parentPath: readonly string[], children: readonly T[]): void {
        for (const child of children) {
            const key = this.getKey(child);
            this.index.set(key, child);
            this.paths.set(key, [...parentPath, key]);
        }
    }

    /**
     * Reconcile the direct children of the node at `parentPath` against a
     * freshly-fetched set: (re-)index the new children and report which
     * previously-indexed direct children have *departed* (were present before,
     * absent now).
     *
     * Departed nodes and their subtrees are deliberately left indexed so the
     * caller can still resolve their paths / {@linkcode descendantKeys} to tear
     * down the stores this index does not own (the children cache, pagers,
     * enrichment). The caller completes removal by evicting each departed
     * subtree from this index too.
     *
     * Indexing the new set never disturbs a departed node: the departed keys are
     * exactly those absent from the new set, so {@linkcode indexChildren} only
     * writes new/surviving entries and leaves every departed node's index / path
     * (and thus its descendants) intact for the caller's teardown.
     *
     * @returns The keys of the direct children that departed.
     */
    public reconcile(parentPath: readonly string[], children: readonly T[]): { departed: string[] } {
        const newKeys = new Set<string>();
        for (const child of children) {
            newKeys.add(this.getKey(child));
        }
        const departed = this.directChildKeys(parentPath).filter(key => !newKeys.has(key));
        this.indexChildren(parentPath, children);
        return { departed };
    }

    /** Drop a single key's index / path entries. Does not touch descendants. */
    public evict(key: string): void {
        this.index.delete(key);
        this.paths.delete(key);
    }

    /** Remove every entry. */
    public clear(): void {
        this.index.clear();
        this.paths.clear();
    }

    /** Keys of the *direct* children of the node at `parentPath`. */
    public directChildKeys(parentPath: readonly string[]): string[] {
        const result: string[] = [];
        for (const [key, path] of this.paths) {
            if (path.length === parentPath.length + 1 && this.isPrefixOrEqual(parentPath, path)) {
                result.push(key);
            }
        }
        return result;
    }

    /** Keys of every *strict* descendant of the node at `path`. */
    public descendantKeys(path: readonly string[]): string[] {
        const result: string[] = [];
        for (const [key, candidate] of this.paths) {
            if (this.isStrictPrefix(path, candidate)) {
                result.push(key);
            }
        }
        return result;
    }

    /**
     * Reduce a set of keys to their apexes: drop any key whose path has an
     * ancestor also present in the set. Unknown keys (not indexed) are dropped.
     */
    public apexes(keys: readonly string[]): string[] {
        const entries = keys
            .map(key => ({ key, path: this.paths.get(key) }))
            .filter((e): e is { key: string; path: readonly string[] } => e.path !== undefined);
        return entries
            .filter(({ path }) => !entries.some(other => this.isStrictPrefix(other.path, path)))
            .map(({ key }) => key);
    }

    /** Whether any ancestor of `key` is in `ancestorKeys`. */
    public hasAncestorIn(key: string, ancestorKeys: ReadonlySet<string>): boolean {
        const path = this.paths.get(key);
        if (path === undefined) {
            return false;
        }
        // Ancestors are the strict prefixes of this path; their keys are the
        // trailing segment of each prefix.
        for (let i = 1; i < path.length; i++) {
            if (ancestorKeys.has(path[i - 1])) {
                return true;
            }
        }
        return false;
    }

    /** The parent resource of `key`, or `undefined` if `key` is a root (or unknown). */
    public parentResourceOf(key: string): T | undefined {
        const path = this.paths.get(key);
        if (path === undefined || path.length < 2) {
            return undefined;
        }
        return this.index.get(path[path.length - 2]);
    }

    /** Whether `prefix` is a prefix of (or equal to) `path`. */
    private isPrefixOrEqual(prefix: readonly string[], path: readonly string[]): boolean {
        return prefix.length <= path.length && prefix.every((seg, i) => path[i] === seg);
    }

    /** Whether `prefix` is a *strict* prefix of `path` (i.e. `path` is a descendant). */
    private isStrictPrefix(prefix: readonly string[], path: readonly string[]): boolean {
        return prefix.length < path.length && this.isPrefixOrEqual(prefix, path);
    }
}
