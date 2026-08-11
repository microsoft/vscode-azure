/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';

/** One candidate project discovered in an open workspace folder. */
export interface WorkspaceProject {
    readonly workspaceFolder: vscode.WorkspaceFolder;
    readonly rootUri: vscode.Uri;
    /** POSIX-style path relative to {@linkcode workspaceFolder}, or `.` for its root. */
    readonly relativePath: string;
    readonly frameworks: readonly string[];
    readonly buildTools: readonly string[];
    readonly languages: readonly string[];
    /**
     * Likely build output, relative to {@linkcode rootUri}. Always project-relative:
     * absolute and parent-traversing paths are discarded rather than rewritten,
     * since consumers assume this stays inside {@linkcode rootUri}.
     */
    readonly outputDirectory?: string;
}

/** Results of a bounded workspace project scan. */
export interface WorkspaceScanResult {
    readonly projects: readonly WorkspaceProject[];
    /**
     * `true` when the entry budget stopped the walk, so {@linkcode projects} may be
     * incomplete. Consumers should not present the list as exhaustive.
     */
    readonly truncated: boolean;
    /**
     * Whether the walk would skip `relativePath` (a workspace-folder-relative,
     * POSIX-style path) as generated, vendored, or `.gitignore`d.
     *
     * Retained from the walk so incremental consumers can discard file events
     * without re-reading every `.gitignore`. This matters more than it looks: a
     * watcher for `**‍/package.json` also matches every manifest under
     * `node_modules`, so an `npm install` would otherwise trigger thousands of
     * pointless rescans.
     */
    isExcluded(workspaceFolder: vscode.WorkspaceFolder, relativePath: string): boolean;
}
