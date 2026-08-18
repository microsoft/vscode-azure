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
 * Mutable {@linkcode WorkspaceIndex} used while building and updating.
 *
 * Backed by a map of tag to the nodes carrying it, keyed by URI, which makes
 * every query a direct lookup, plus the reverse map of URI to its tags so a
 * node can be evicted without scanning every tag. Eviction is what keeps
 * incremental updates honest: re-inspecting a node without first removing its
 * entries would append to {@linkcode values} a second time.
 */
export class MutableWorkspaceIndex implements WorkspaceIndex {
    private readonly byTag = new Map<string, Map<string, { uri: vscode.Uri; values: string[] }>>();
    private readonly tagsByUri = new Map<string, Set<string>>();

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

        let tags = this.tagsByUri.get(key);
        if (!tags) {
            tags = new Set();
            this.tagsByUri.set(key, tags);
        }
        tags.add(tag);

        // A valueless tag records its presence only, so repeated application is
        // idempotent rather than accumulating a run of `undefined`.
        if (value !== undefined) {
            entry.values.push(value);
        }
    }

    /**
     * Forgets every tag on `uri`, so it can be inspected again from scratch.
     *
     * @returns Whether anything was recorded against `uri`.
     */
    public evict(uri: vscode.Uri): boolean {
        return this.evictKey(uri.toString());
    }

    /**
     * Forgets `uri` and everything beneath it.
     *
     * Deleting a directory reports a single event for the directory rather than
     * one per file inside it, so the descendants have to be swept explicitly or
     * they linger forever.
     *
     * @returns Whether anything was recorded against `uri` or its descendants.
     */
    public evictSubtree(uri: vscode.Uri): boolean {
        const prefix = `${uri.toString()}/`;
        let evicted = this.evict(uri);
        for (const key of [...this.tagsByUri.keys()]) {
            if (key.startsWith(prefix)) {
                evicted = this.evictKey(key) || evicted;
            }
        }
        return evicted;
    }

    /** @inheritdoc */
    public withTag(tag: string): readonly vscode.Uri[] {
        // Sorted rather than left in insertion order: an incrementally updated
        // node is re-added last, and a project jumping to the end of the tree
        // after an unrelated edit would be visible to the user.
        return [...this.byTag.get(tag)?.values() ?? []]
            .map(entry => entry.uri)
            .sort(compareByDepthThenPath);
    }

    /** @inheritdoc */
    public has(uri: vscode.Uri, tag: string): boolean {
        return this.byTag.get(tag)?.has(uri.toString()) ?? false;
    }

    /** @inheritdoc */
    public valuesOf(uri: vscode.Uri, tag: string): readonly string[] {
        return this.byTag.get(tag)?.get(uri.toString())?.values ?? [];
    }

    private evictKey(key: string): boolean {
        const tags = this.tagsByUri.get(key);
        if (!tags) {
            return false;
        }
        for (const tag of tags) {
            const tagged = this.byTag.get(tag);
            tagged?.delete(key);
            if (tagged?.size === 0) {
                this.byTag.delete(tag);
            }
        }
        this.tagsByUri.delete(key);
        return true;
    }
}

/** Shallowest first, then by path, matching the order a fresh walk produces. */
function compareByDepthThenPath(left: vscode.Uri, right: vscode.Uri): number {
    const depth = countSegments(left.path) - countSegments(right.path);
    return depth !== 0 ? depth : left.path.localeCompare(right.path);
}

function countSegments(path: string): number {
    let count = 0;
    for (const character of path) {
        if (character === '/') {
            count++;
        }
    }
    return count;
}
