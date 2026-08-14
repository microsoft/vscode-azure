/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';

/**
 * Queryable result of an index build: which files and directories carry which
 * tags.
 *
 * Only tagged nodes are retained, so the index is proportional to what
 * detectors found rather than to the size of the workspace. Everything else a
 * caller might want -- the name, the containing workspace folder -- is derived
 * from the {@linkcode vscode.Uri Uri}, so the index stores nothing but tags.
 */
export interface WorkspaceIndex {
    /**
     * Files and directories carrying `tag`, in discovery order (shallowest
     * first).
     *
     * Namespaced: `withTag(createTag('node', 'sourceFile'))` never returns
     * files tagged by the C# detector, even though both use the name
     * `sourceFile`.
     */
    withTag(tag: string): readonly vscode.Uri[];

    /** Whether the node at `uri` carries `tag`. */
    has(uri: vscode.Uri, tag: string): boolean;

    /**
     * Values recorded for `tag` at `uri`, in application order. Empty when the
     * tag is absent or carries no values.
     */
    valuesOf(uri: vscode.Uri, tag: string): readonly string[];
}

/**
 * Mutable {@linkcode WorkspaceIndex} used while building.
 *
 * Backed by one map of tag to the nodes carrying it, keyed by URI, which makes
 * every query a direct lookup. Insertion order gives discovery order for free,
 * since the walk reports shallower directories first.
 */
export class MutableWorkspaceIndex implements WorkspaceIndex {
    private readonly byTag = new Map<string, Map<string, { uri: vscode.Uri; values: string[] }>>();

    /** Records `tag` on `uri`, creating its entry on first use. */
    public add(uri: vscode.Uri, tag: string, value: string | undefined): void {
        let tagged = this.byTag.get(tag);
        if (!tagged) {
            tagged = new Map();
            this.byTag.set(tag, tagged);
        }

        const key = uri.toString();
        let entry = tagged.get(key);
        if (!entry) {
            entry = { uri, values: [] };
            tagged.set(key, entry);
        }

        // A valueless tag records its presence only, so repeated application is
        // idempotent rather than accumulating a run of `undefined`.
        if (value !== undefined) {
            entry.values.push(value);
        }
    }

    /** @inheritdoc */
    public withTag(tag: string): readonly vscode.Uri[] {
        return [...this.byTag.get(tag)?.values() ?? []].map(entry => entry.uri);
    }

    /** @inheritdoc */
    public has(uri: vscode.Uri, tag: string): boolean {
        return this.byTag.get(tag)?.has(uri.toString()) ?? false;
    }

    /** @inheritdoc */
    public valuesOf(uri: vscode.Uri, tag: string): readonly string[] {
        return this.byTag.get(tag)?.get(uri.toString())?.values ?? [];
    }
}
