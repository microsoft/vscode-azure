/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The minimal shape a node must expose to live in a {@linkcode NodeMap}.
 *
 * Unlike a flat string-keyed store, parent/child relationships are expressed as
 * **object pointers** ({@linkcode children} / {@linkcode parent}), so the map
 * never reconstructs the hierarchy from keys.
 *
 * @typeParam TNode - The concrete node type.
 * @internal
 */
export interface MappedNode<TNode> {
    /** Cached child nodes, or `undefined` when children have not been loaded. */
    children: TNode[] | undefined;

    /** Back-pointer to the parent node, or `undefined` for root nodes. */
    parent?: TNode | undefined;
}

/**
 * A string-keyed map of tree nodes that supports recursive subtree removal and
 * a structural **root set** (nodes with no parent).
 *
 * The hierarchy lives in the node objects themselves
 * ({@linkcode MappedNode.children} / {@linkcode MappedNode.parent}); the map
 * only adds O(1) key lookup, subtree removal, and a root set
 * ({@linkcode roots}) that is kept consistent as nodes are removed.
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
     * The set of root nodes (those with no parent). Maintained as nodes are
     * registered ({@linkcode registerRoot}) and removed
     * ({@linkcode removeSubtrees} / {@linkcode clear}).
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

    /** Set a node by key. */
    public set(key: string, node: TNode): void {
        this.map.set(key, node);
    }

    /** Remove all entries from the map (and the root set). */
    public clear(): void {
        this.map.clear();
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
     * Recursively remove nodes and all their descendants from the map,
     * discovered by walking each node's {@linkcode MappedNode.children}
     * (children-first). Each removed node is dropped from the root set.
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

    /** Forget a node: drop it from the root set and delete it from the key map. */
    private forget(node: TNode): void {
        this.rootNodes.delete(node);
        this.map.delete(this.getKey(node));
    }
}
