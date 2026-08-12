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

    /**
     * Nodes carrying a tag with `name` in **any** namespace, in discovery
     * order.
     *
     * The deliberately cross-cutting counterpart to {@linkcode withTag}: use it
     * to ask "every source file, whoever recognised it". Values from different
     * namespaces are merged, so prefer {@linkcode withTag} unless the query is
     * genuinely namespace-agnostic.
     */
    withTagName(name: string): readonly TaggedNode<unknown>[];

    /** Whether the node at `uri` carries `tag`. */
    has<T>(uri: vscode.Uri, tag: WorkspaceTag<T>): boolean;

    /** Every tag on the node at `uri`, across all namespaces. */
    tagsOf(uri: vscode.Uri): readonly WorkspaceTag[];

    /**
     * `true` when a scan limit stopped the walk, so the index may be
     * incomplete. Consumers should avoid presenting results as exhaustive.
     */
    readonly truncated: boolean;
}

interface IndexEntry {
    readonly node: IndexedNode;
    /** Values per qualified tag name, in application order. */
    readonly tags: Map<string, unknown[]>;
    /** Position in discovery order, so query results are stable. */
    readonly sequence: number;
}

/**
 * Mutable {@linkcode WorkspaceIndex} used while building.
 *
 * Backed by three maps: entries by URI, URIs by qualified tag name (so
 * {@linkcode WorkspaceIndex.withTag} is proportional to the number of matches),
 * and qualified names by bare name (so {@linkcode WorkspaceIndex.withTagName}
 * fans out over the few namespaces that use it).
 */
export class MutableWorkspaceIndex implements WorkspaceIndex {
    private readonly entries = new Map<string, IndexEntry>();
    private readonly byQualifiedName = new Map<string, Set<string>>();
    private readonly qualifiedNamesByName = new Map<string, Set<string>>();
    private sequence = 0;

    public truncated = false;

    /** Records `tag` on `node`, creating its entry on first use. */
    public add<T>(node: IndexedNode, tag: WorkspaceTag<T>, value: T | undefined): void {
        const key = node.uri.toString();
        let entry = this.entries.get(key);
        if (!entry) {
            entry = { node, tags: new Map(), sequence: this.sequence++ };
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

        addTo(this.byQualifiedName, tag.qualifiedName, key);
        addTo(this.qualifiedNamesByName, tag.name, tag.qualifiedName);
    }

    /** @inheritdoc */
    public withTag<T>(tag: WorkspaceTag<T>): readonly TaggedNode<T>[] {
        return this.collect([tag.qualifiedName]) as TaggedNode<T>[];
    }

    /** @inheritdoc */
    public withTagName(name: string): readonly TaggedNode<unknown>[] {
        return this.collect([...this.qualifiedNamesByName.get(name) ?? []]);
    }

    /** @inheritdoc */
    public has<T>(uri: vscode.Uri, tag: WorkspaceTag<T>): boolean {
        return this.entries.get(uri.toString())?.tags.has(tag.qualifiedName) ?? false;
    }

    /** @inheritdoc */
    public tagsOf(uri: vscode.Uri): readonly WorkspaceTag[] {
        const entry = this.entries.get(uri.toString());
        if (!entry) {
            return [];
        }
        return [...entry.tags.keys()].map(qualifiedName => {
            const separator = qualifiedName.indexOf(':');
            return {
                namespace: qualifiedName.slice(0, separator),
                name: qualifiedName.slice(separator + 1),
                qualifiedName,
            } satisfies WorkspaceTag;
        });
    }

    /** Values recorded for `tag` on `node`, used by detectors mid-build. */
    public valuesOf<T>(uri: vscode.Uri, tag: WorkspaceTag<T>): readonly T[] {
        return (this.entries.get(uri.toString())?.tags.get(tag.qualifiedName) ?? []) as T[];
    }

    private collect(qualifiedNames: readonly string[]): TaggedNode<unknown>[] {
        const matches = new Map<string, TaggedNode<unknown>>();

        for (const qualifiedName of qualifiedNames) {
            for (const key of this.byQualifiedName.get(qualifiedName) ?? []) {
                const entry = this.entries.get(key);
                if (!entry) {
                    continue;
                }
                const values = entry.tags.get(qualifiedName) ?? [];
                const existing = matches.get(key);
                if (existing) {
                    // Same node matched under several namespaces: merge rather
                    // than reporting it twice.
                    matches.set(key, { ...existing, values: [...existing.values, ...values] });
                } else {
                    matches.set(key, { ...entry.node, values: [...values] });
                }
            }
        }

        return [...matches.keys()]
            .sort((left, right) => sequenceOf(this.entries, left) - sequenceOf(this.entries, right))
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- keys come from `matches`
            .map(key => matches.get(key)!);
    }
}

function addTo(map: Map<string, Set<string>>, key: string, value: string): void {
    let values = map.get(key);
    if (!values) {
        values = new Set();
        map.set(key, values);
    }
    values.add(value);
}

function sequenceOf(entries: ReadonlyMap<string, IndexEntry>, key: string): number {
    return entries.get(key)?.sequence ?? 0;
}
