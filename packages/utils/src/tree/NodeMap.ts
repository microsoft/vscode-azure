/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A string-keyed map of tree nodes that supports recursive subtree removal.
 *
 * @typeParam TNode - The node type stored in the map. Must have a `children`
 *   array (or `undefined`) whose element type is assignable to `TNode`.
 * @internal
 */
export class NodeMap<TNode extends { children: TNode[] | undefined }> {
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
     * Recursively remove nodes and all their descendants from the map.
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
