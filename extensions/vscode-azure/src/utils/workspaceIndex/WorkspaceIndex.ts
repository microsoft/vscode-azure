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

interface IndexEntry {
    readonly node: IndexedNode;
    /** Values per qualified tag name, in application order. */
    readonly tags: Map<string, unknown[]>;
}

/**
 * Mutable {@linkcode WorkspaceIndex} used while building.
 *
 * Backed by two maps: entries by URI, and URIs by qualified tag name so
 * {@linkcode withTag} is proportional to the number of matches rather than to
 * the size of the index. Insertion order gives discovery order for free, since
 * the walk reports shallower directories first.
 */
export class MutableWorkspaceIndex implements WorkspaceIndex {
    private readonly entries = new Map<string, IndexEntry>();
    private readonly byQualifiedName = new Map<string, Set<string>>();

    /** Records `tag` on `node`, creating its entry on first use. */
    public add<T>(node: IndexedNode, tag: WorkspaceTag<T>, value: T | undefined): void {
        const key = node.uri.toString();
        let entry = this.entries.get(key);
        if (!entry) {
            entry = { node, tags: new Map() };
            this.entries.set(key, entry);
        }

        let values = entry.tags.get(tag.qualifiedName);
        if (!values) {
            values = [];
            entry.tags.set(tag.qualifiedName, values);
        }
        // A valueless tag records its presence only, so repeated application is
        // idempotent rather than accumulating a run of `undefined`.
        if (value !== undefined) {
            values.push(value);
        }

        let tagged = this.byQualifiedName.get(tag.qualifiedName);
        if (!tagged) {
            tagged = new Set();
            this.byQualifiedName.set(tag.qualifiedName, tagged);
        }
        tagged.add(key);
    }

    /** @inheritdoc */
    public withTag<T>(tag: WorkspaceTag<T>): readonly TaggedNode<T>[] {
        const matches: TaggedNode<T>[] = [];
        for (const key of this.byQualifiedName.get(tag.qualifiedName) ?? []) {
            const entry = this.entries.get(key);
            if (entry) {
                matches.push({ ...entry.node, values: (entry.tags.get(tag.qualifiedName) ?? []) as T[] });
            }
        }
        return matches;
    }

    /** @inheritdoc */
    public has<T>(uri: vscode.Uri, tag: WorkspaceTag<T>): boolean {
        return this.entries.get(uri.toString())?.tags.has(tag.qualifiedName) ?? false;
    }
}
