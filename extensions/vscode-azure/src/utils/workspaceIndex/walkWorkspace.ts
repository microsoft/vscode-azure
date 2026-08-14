/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isFileNotFoundError, throwIfCancelled, type IVsCode } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';

/**
 * Directories never descended into: generated output, dependency caches, and
 * VCS metadata. Skipping these is most of what makes a walk affordable.
 *
 * Plain names rather than globs, because this is tested once per directory
 * entry: a `Set` lookup is ~3000x faster than `matchesGlob`, which recompiles
 * its pattern on every call. Nothing here needs more than a name match.
 */
export const defaultExcludedDirectories: ReadonlySet<string> = new Set([
    '.git', '.hg', '.svn',
    'node_modules', 'bower_components', 'vendor',
    'bin', 'obj', 'target', 'build', 'dist', 'out',
    '.next', '.nuxt', '.output', '.svelte-kit',
    '.venv', 'venv', '__pycache__', '.tox',
    '.gradle', '.terraform', 'coverage',
]);

/**
 * Directory entries visited per workspace folder before the walk stops
 * descending. Bounds a pathological tree (a huge monorepo, or a user who opened
 * their home directory) so a rebuild cannot hang the extension host.
 */
const maxEntriesPerFolder = 5000;

/** One directory reached by {@linkcode walkWorkspace}. */
export interface ScannedDirectory {
    readonly uri: vscode.Uri;
    /** Names of the files directly inside this directory. */
    readonly fileNames: ReadonlySet<string>;
}

/**
 * Walks the open workspace folders, yielding each directory with its file names.
 *
 * **Internal to the workspace index**: it is the traversal engine behind
 * `buildWorkspaceIndex`. Product code should go through
 * `IWorkspaceIndexService`, so one walk and one watcher serve every consumer.
 *
 * Breadth-first, so shallower directories arrive first, and entries within a
 * directory are visited in name order so repeated walks agree.
 *
 * Symlinked *directories* are not descended into, since they can form cycles or
 * point outside the workspace; symlinked *files* are still listed, because
 * reading one cannot loop.
 *
 * @throws {@linkcode CancellationError} when `token` is cancelled.
 */
export async function* walkWorkspace(
    code: IVsCode,
    token?: vscode.CancellationToken,
): AsyncIterable<ScannedDirectory> {
    for (const folder of code.workspace.workspaceFolders ?? []) {
        yield* walkFolder(code, folder.uri, token);
    }
}

async function* walkFolder(
    code: IVsCode,
    root: vscode.Uri,
    token: vscode.CancellationToken | undefined,
): AsyncIterable<ScannedDirectory> {
    // Breadth-first: appending to the queue being iterated reports every
    // directory at one depth before any of their children.
    const pending: vscode.Uri[] = [root];
    let entriesVisited = 0;

    for (const uri of pending) {
        throwIfCancelled(token, 'walkWorkspace');

        let entries: [string, vscode.FileType][];
        try {
            entries = await code.workspace.fs.readDirectory(uri);
        } catch (error) {
            // A directory disappearing mid-walk is an expected race; anything
            // else (permissions, provider failure) is worth surfacing.
            if (isFileNotFoundError(error)) {
                continue;
            }
            throw error;
        }

        entriesVisited += entries.length;
        // The filesystem gives no ordering guarantee, so sort for a stable walk:
        // tree consumers would otherwise see children reorder between refreshes.
        entries.sort(([left], [right]) => left.localeCompare(right));

        const fileNames = new Set<string>();
        const subdirectories: vscode.Uri[] = [];

        for (const [name, type] of entries) {
            if ((type & code.FileType.Directory) !== 0) {
                const isSymbolicLink = (type & code.FileType.SymbolicLink) !== 0;
                if (!isSymbolicLink && !defaultExcludedDirectories.has(name.toLowerCase())) {
                    subdirectories.push(code.Uri.joinPath(uri, name));
                }
            } else if ((type & code.FileType.File) !== 0) {
                fileNames.add(name);
            }
        }

        // Reported before the budget check below, so a directory that was
        // already read is never discarded -- a wide root would otherwise yield
        // nothing at all.
        yield { uri, fileNames };

        if (entriesVisited >= maxEntriesPerFolder) {
            return;
        }
        pending.push(...subdirectories);
    }
}
