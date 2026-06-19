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
 * A string-keyed map of tree nodes that supports recursive subtree removal.
 *
 * The hierarchy lives in the node objects themselves
 * ({@linkcode MappedNode.children} / {@linkcode MappedNode.parent}); the map
 * only adds O(1) key lookup and subtree removal.
 *
 * The map is deliberately ignorant of resources, providers, TTL, roots, and
 * change events: it answers structural questions and leaves policy (including
 * which nodes are roots) to its owner (e.g. {@linkcode DataItemTree} /
 * {@linkcode ViewItemTree}, each of which keeps its own roots list).
 *
 * @typeParam TNode - The node type stored in the map. Must satisfy
 *   {@linkcode MappedNode}.
 * @internal
 */
export class NodeMap<TNode extends MappedNode<TNode>> {
    private readonly map = new Map<string, TNode>();

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

    /** Remove all entries from the map. */
    public clear(): void {
        this.map.clear();
    }

    /**
     * Recursively remove nodes and all their descendants from the map,
     * discovered by walking each node's {@linkcode MappedNode.children}
     * (children-first).
     *
     * This does **not** unlink the removed nodes from any surviving parent's
     * children array (or from any roots list the owner keeps); callers that
     * need that (e.g. removing a single item) splice the relevant list
     * themselves.
     */
    public removeSubtrees(nodes: TNode[] | undefined): void {
        if (!nodes) {
            return;
        }
        for (const node of nodes) {
            this.removeSubtrees(node.children);
            this.map.delete(this.getKey(node));
        }
    }
}
