/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import type { AppliedTag, WorkspaceTag } from './WorkspaceTag';

/**
 * A workspace folder in the index. These are the root nodes of the underlying
 * cache; scanning is driven per folder, so a folder is also the unit of
 * invalidation.
 */
export interface WorkspaceFolderIndexNode {
    readonly kind: 'folder';
    /** Stable cache key. */
    readonly id: string;
    /** The folder this node indexes. */
    readonly folder: vscode.WorkspaceFolder;
}

/**
 * One file or folder that at least one detector tagged.
 *
 * Entries only exist for tagged locations -- the index is not a mirror of the
 * filesystem. An entry's {@linkcode tags} may come from several detectors; the
 * scan merges all applications for a given URI into a single entry.
 */
export interface WorkspaceEntry {
    readonly kind: 'entry';
    /** Stable cache key, qualified by the owning folder. */
    readonly id: string;
    /** The tagged file or folder. */
    readonly uri: vscode.Uri;
    /** Workspace folder this entry was discovered under. */
    readonly folder: vscode.WorkspaceFolder;
    /**
     * Whether the entry is a directory, as reported by the detector that
     * produced it. Detectors that tag a project root report `true`.
     */
    readonly isDirectory: boolean;
    /**
     * Tags applied to this entry, in detector registration order.
     *
     * Mutable because {@linkcode WorkspaceDetector.enrich} may append
     * late-arriving tags in place, keeping the entry's object identity stable
     * for callers holding a reference.
     */
    tags: AppliedTag[];
}

/** Any node stored in the workspace index cache. */
export type WorkspaceIndexNode = WorkspaceFolderIndexNode | WorkspaceEntry;

/** Type guard for {@linkcode WorkspaceFolderIndexNode}. */
export function isWorkspaceFolderIndexNode(value: unknown): value is WorkspaceFolderIndexNode {
    return isIndexNode(value) && value.kind === 'folder';
}

/** Type guard for {@linkcode WorkspaceEntry}. */
export function isWorkspaceEntry(value: unknown): value is WorkspaceEntry {
    return isIndexNode(value) && value.kind === 'entry';
}

function isIndexNode(value: unknown): value is WorkspaceIndexNode {
    return typeof value === 'object' && value !== null && 'kind' in value && 'id' in value;
}

/** Build the cache key for a workspace folder node. */
export function folderNodeId(folder: vscode.WorkspaceFolder): string {
    return `folder::${folder.uri.toString()}`;
}

/**
 * Build the cache key for an entry.
 *
 * Qualified by the owning folder so that overlapping multi-root folders (a
 * parent and a child folder both open) can each hold their own entry for the
 * same URI without colliding in the cache.
 */
export function entryNodeId(folder: vscode.WorkspaceFolder, uri: vscode.Uri): string {
    return `entry::${folder.uri.toString()}::${uri.toString()}`;
}

/** Returns `true` when {@linkcode entry} carries {@linkcode tag}. */
export function hasTag(entry: WorkspaceEntry, tag: WorkspaceTag<never>): boolean;
export function hasTag<TMetadata>(entry: WorkspaceEntry, tag: WorkspaceTag<TMetadata>): boolean;
export function hasTag(entry: WorkspaceEntry, tag: WorkspaceTag<unknown>): boolean {
    return entry.tags.some(applied => applied.tag.name === tag.name);
}

/**
 * Read the metadata {@linkcode tag} was applied with on {@linkcode entry}, typed
 * as the tag declared it.
 *
 * Returns `undefined` both when the tag is absent and when it was applied
 * without metadata; use {@linkcode hasTag} to tell those apart. If the same tag
 * was somehow applied twice, the first application wins.
 */
export function getTagMetadata<TMetadata>(entry: WorkspaceEntry, tag: WorkspaceTag<TMetadata>): TMetadata | undefined {
    const applied = entry.tags.find(candidate => candidate.tag.name === tag.name);
    return applied?.metadata as TMetadata | undefined;
}
