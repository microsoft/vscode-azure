/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The minimal shape a node must expose to live in a {@linkcode NodeMap}.
 *
 * Unlike a flat string-keyed store, parent/child relationships are expressed as
 * **object pointers** ({@linkcode children} / {@linkcode parent}), so the map
 * never reconstructs the hierarchy from keys. The optional {@linkcode tags}
 * field is owned by the map: it is set by {@linkcode NodeMap.registerTags} and
 * cleared when the node is removed, and callers should not mutate it directly.
 *
 * @typeParam TNode - The concrete node type.
 * @internal
 */
export interface MappedNode<TNode> {
    /** Cached child nodes, or `undefined` when children have not been loaded. */
    children: TNode[] | undefined;

    /** Back-pointer to the parent node, or `undefined` for root nodes. */
    parent?: TNode | undefined;

    /**
     * Semantic identity tags carried by this node, or `undefined` when it
     * carries none. Maintained by {@linkcode NodeMap}; owners pass tags to
     * {@linkcode NodeMap.registerTags} and never mutate this field directly.
     */
    tags?: string[];
}

/**
 * A string-keyed map of tree nodes that supports recursive subtree removal, a
 * side **tag reverse index** for tag-based subtree eviction, and a structural
 * **root set** (nodes with no parent).
 *
 * The hierarchy lives in the node objects themselves
 * ({@linkcode MappedNode.children} / {@linkcode MappedNode.parent}); the map
 * only adds O(1) key lookup, subtree removal, a `tag -> nodes` reverse index
 * that powers {@linkcode evictByTag}, and a root set ({@linkcode roots}) that is
 * kept consistent as nodes are removed. Tags are purely *semantic*
 * (owner-supplied identity tags such as `account:<id>`) -- the map derives no
 * structural ancestor tags; subtree membership is discovered by walking
 * {@linkcode MappedNode.children}.
 *
 * The map is deliberately ignorant of resources, providers, TTL, and change
 * events: it answers structural questions and leaves policy/event reactions to
 * its owner (e.g. {@linkcode DataItemTree}).
 *
 * @typeParam TNode - The node type stored in the map. Must satisfy
 *   {@linkcode MappedNode}.
 * @internal
 */
export class NodeMap<TNode extends MappedNode<TNode>> {
    private readonly map = new Map<string, TNode>();

    /**
     * Reverse index mapping a semantic tag to the set of nodes carrying it.
     * Kept consistent as nodes are tagged ({@linkcode registerTags}) and removed
     * ({@linkcode removeSubtrees} / {@linkcode evictByTag} / {@linkcode clear}).
     */
    private readonly tagIndex = new Map<string, Set<TNode>>();

    /**
     * The set of root nodes (those with no parent). Maintained as nodes are
     * registered ({@linkcode registerRoot}) and removed
     * ({@linkcode removeSubtrees} / {@linkcode evictByTag} / {@linkcode clear}).
     *
     * Membership is structural -- a node is a root iff it has no parent -- so
     * owners need not keep a parallel roots collection. The set preserves
     * registration order, but callers should treat ordering as incidental: the
     * data layer is order-agnostic and the view layer re-derives presentation
     * order.
     */
    private readonly rootNodes = new Set<TNode>();

    /**
     * @param getKey - Extracts the unique string key for a node.
     */
    public constructor(
        private readonly getKey: (node: TNode) => string,
    ) { }

    /** Get a node by key. */
    public get(key: string): TNode | undefined {
        return this.map.get(key);
    }

    /** Set a node by key. Does not tag the node; call {@linkcode registerTags} after. */
    public set(key: string, node: TNode): void {
        this.map.set(key, node);
    }

    /** Remove all entries from the map (and the tag index and root set). */
    public clear(): void {
        this.map.clear();
        this.tagIndex.clear();
        this.rootNodes.clear();
    }

    /**
     * Record an already-stored node as a root (a node with no parent). Roots are
     * tracked structurally so owners don't keep a parallel collection; the node
     * is dropped from the set automatically when it is removed.
     *
     * Idempotent: registering a node that is already a root is a no-op.
     *
     * @param node - The root node (normally already stored via {@linkcode set}).
     */
    public registerRoot(node: TNode): void {
        this.rootNodes.add(node);
    }

    /** The set of currently-registered root nodes, in registration order. */
    public roots(): ReadonlySet<TNode> {
        return this.rootNodes;
    }

    /**
     * Record an already-stored node under the given semantic tags: sets
     * {@linkcode MappedNode.tags} and adds the node to each tag's set in the
     * reverse index.
     *
     * Idempotency is the caller's responsibility: this appends, so it should be
     * called exactly once per freshly-created node. A node with no semantic tags
     * is left untagged (and absent from the index).
     *
     * @param node - The node to tag (normally already stored via {@linkcode set}
     *   so it can later be found by {@linkcode get}).
     * @param semanticTags - Owner-supplied identity tags (e.g. `account:<id>`).
     */
    public registerTags(node: TNode, semanticTags: readonly string[]): void {
        if (semanticTags.length === 0) {
            return;
        }
        node.tags = [...semanticTags];
        for (const tag of semanticTags) {
            let set = this.tagIndex.get(tag);
            if (!set) {
                set = new Set<TNode>();
                this.tagIndex.set(tag, set);
            }
            set.add(node);
        }
    }

    /** The set of nodes currently carrying the given tag, if any. */
    public nodesForTag(tag: string): ReadonlySet<TNode> | undefined {
        return this.tagIndex.get(tag);
    }

    /**
     * Recursively remove nodes and all their descendants from the map,
     * discovered by walking each node's {@linkcode MappedNode.children}
     * (children-first). Each removed node's tags are pruned from the reverse
     * index.
     *
     * This does **not** unlink the removed nodes from any surviving parent's
     * children array; callers that need that (e.g. removing a single item)
     * splice the parent list themselves.
     */
    public removeSubtrees(nodes: TNode[] | undefined): void {
        if (!nodes) {
            return;
        }
        for (const node of nodes) {
            this.removeSubtrees(node.children);
            this.forget(node);
        }
    }

    /**
     * Hard-evict every node carrying the given tag, *plus* everything beneath
     * those nodes (their subtrees, discovered by walking
     * {@linkcode MappedNode.children}). Each evicted node is unlinked from any
     * surviving parent's children array, dropped from the root set, has its tags
     * pruned, and is deleted from the map.
     *
     * Any change-event reaction is the caller's responsibility -- the returned
     * array carries every removed node (with its {@linkcode MappedNode.parent}
     * pointer intact) so the caller can reconcile its own auxiliary state (e.g.
     * pending enrichment, event scope).
     *
     * Resilient to unknown tags (returns `[]`) and to a tag carried by many
     * nodes.
     *
     * @param tag - The semantic tag to evict by.
     * @returns The removed nodes, in no particular order.
     */
    public evictByTag(tag: string): TNode[] {
        const seeds = this.tagIndex.get(tag);
        if (!seeds || seeds.size === 0) {
            return [];
        }

        // Expand to the full removal set: each matched node plus its whole
        // subtree, found by walking child pointers.
        const removeSet = new Set<TNode>();
        const collect = (node: TNode): void => {
            if (removeSet.has(node)) {
                return;
            }
            removeSet.add(node);
            if (node.children) {
                for (const child of node.children) {
                    collect(child);
                }
            }
        };
        for (const node of seeds) {
            collect(node);
        }

        const removed: TNode[] = [];
        for (const node of removeSet) {
            const parent = node.parent;
            if (parent && !removeSet.has(parent) && parent.children) {
                const childIdx = parent.children.indexOf(node);
                if (childIdx !== -1) {
                    parent.children.splice(childIdx, 1);
                }
            }
            this.forget(node);
            removed.push(node);
        }
        return removed;
    }

    /**
     * Forget a node: prune its tags from the reverse index, drop it from the
     * root set, and delete it from the key map.
     */
    private forget(node: TNode): void {
        this.pruneTags(node);
        this.rootNodes.delete(node);
        this.map.delete(this.getKey(node));
    }

    /** Remove a node's tags from the reverse index and clear its `tags`. */
    private pruneTags(node: TNode): void {
        if (!node.tags) {
            return;
        }
        for (const tag of node.tags) {
            const set = this.tagIndex.get(tag);
            if (set) {
                set.delete(node);
                if (set.size === 0) {
                    this.tagIndex.delete(tag);
                }
            }
        }
        node.tags = undefined;
    }
}
