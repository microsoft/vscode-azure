/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import type { IndexedNode } from './WorkspaceDetector';
import type { WorkspaceTag } from './WorkspaceTag';

/** A node carrying a queried tag, with the values recorded for it. */
export interface TaggedNode<T> extends IndexedNode {
    /**
     * Values recorded for the queried tag, in application order. Empty for a
     * tag that carries no value.
     */
    readonly values: readonly T[];
}

/**
 * Queryable result of an index build: which workspace nodes carry which tags.
 *
 * Only tagged nodes are retained, so the index is proportional to what
 * detectors found rather than to the size of the workspace.
 */
export interface WorkspaceIndex {
    /**
     * Nodes carrying `tag`, in discovery order (shallowest first).
     *
     * Namespaced: `withTag(node.sourceFile)` never returns files tagged by the
     * C# detector, even though both use the name `sourceFile`.
     */
    withTag<T>(tag: WorkspaceTag<T>): readonly TaggedNode<T>[];

    /** Whether the node at `uri` carries `tag`. */
    has<T>(uri: vscode.Uri, tag: WorkspaceTag<T>): boolean;
}

interface MutableTaggedNode extends IndexedNode {
    readonly values: unknown[];
}

/**
 * Mutable {@linkcode WorkspaceIndex} used while building.
 *
 * Backed by one map of qualified tag name to the nodes carrying it, keyed by
 * URI, which makes both queries direct lookups. Insertion order gives discovery
 * order for free, since the walk reports shallower directories first.
 */export class MutableWorkspaceIndex implements WorkspaceIndex {
    private readonly byTag = new Map<string, Map<string, MutableTaggedNode>>();

    /** Records `tag` on `node`, creating its entry on first use. */
    public add<T>(node: IndexedNode, tag: WorkspaceTag<T>, value: T | undefined): void {
        let nodes = this.byTag.get(tag.qualifiedName);
        if (!nodes) {
            nodes = new Map();
            this.byTag.set(tag.qualifiedName, nodes);
        }

        const key = node.uri.toString();
        let tagged = nodes.get(key);
        if (!tagged) {
            tagged = { ...node, values: [] };
            nodes.set(key, tagged);
        }

        // A valueless tag records its presence only, so repeated application is
        // idempotent rather than accumulating a run of `undefined`.
        if (value !== undefined) {
            tagged.values.push(value);
        }
    }

    /** @inheritdoc */
    public withTag<T>(tag: WorkspaceTag<T>): readonly TaggedNode<T>[] {
        return [...this.byTag.get(tag.qualifiedName)?.values() ?? []] as TaggedNode<T>[];
    }

    /** @inheritdoc */
    public has<T>(uri: vscode.Uri, tag: WorkspaceTag<T>): boolean {
        return this.byTag.get(tag.qualifiedName)?.has(uri.toString()) ?? false;
    }
}
