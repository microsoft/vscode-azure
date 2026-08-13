/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isFileNotFoundError, readText, relativePath, throwIfCancelled, type IVsCode } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';

/**
 * Directories never descended into: generated output, dependency caches, and
 * VCS metadata. Skipping these is most of what makes a walk affordable, and it
 * matters most when scanning source files -- a `.cs` sweep would otherwise hit
 * `bin`/`obj`, and a `.py` sweep would hit `.venv`.
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
    /** The containing workspace folder, if this directory is inside one. */
    readonly workspaceFolder: vscode.WorkspaceFolder | undefined;
    /** POSIX-style path relative to the workspace folder, or `.` for its root. */
    readonly relativePath: string;
    /** Names of the files directly inside this directory. */
    readonly fileNames: ReadonlySet<string>;

    /** The {@linkcode vscode.Uri Uri} of a file in this directory. */
    fileUri(name: string): vscode.Uri;

    /** Full contents of a file here, or `undefined` if it is not present. */
    text(name: string): Promise<string | undefined>;
}

/**
 * Walks the open workspace folders, yielding each directory with its file names
 * and reads.
 *
 * **Internal to the workspace index.** It is the traversal engine behind
 * `buildWorkspaceIndex` -- owning exclusions and cancellation -- and is kept
 * separate because those concerns are testable independently of tagging.
 * Product code should go through `IWorkspaceIndexService`, so one walk and one
 * watcher serve every consumer.
 *
 * Breadth-first, so shallower directories arrive first, and entries within a
 * directory are visited in name order so repeated walks agree.
 *
 * Symlinked *directories* are not descended into, since they can form cycles or
 * point outside the workspace; symlinked *files* are still listed and readable,
 * because reading one cannot loop.
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
    const pending: vscode.Uri[] = [root];
    let entriesVisited = 0;

    while (pending.length > 0) {
        throwIfCancelled(token, 'walkWorkspace');
        // Breadth-first: shallower directories are reported before deeper ones.
        const directoryUri = pending.shift();
        if (!directoryUri) {
            break;
        }

        let entries: [string, vscode.FileType][];
        try {
            entries = await code.workspace.fs.readDirectory(directoryUri);
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
            const entryUri = code.Uri.joinPath(directoryUri, name);
            if ((type & code.FileType.Directory) !== 0) {
                const isSymbolicLink = (type & code.FileType.SymbolicLink) !== 0;
                if (!isSymbolicLink && !defaultExcludedDirectories.has(name.toLowerCase())) {
                    subdirectories.push(entryUri);
                }
            } else if ((type & code.FileType.File) !== 0) {
                fileNames.add(name);
            }
        }

        // Reported before the budget check below, so a directory that was
        // already read is never discarded -- a wide root would otherwise yield
        // nothing at all.
        yield createScannedDirectory(code, directoryUri, root, fileNames, token);

        if (entriesVisited >= maxEntriesPerFolder) {
            return;
        }
        pending.push(...subdirectories);
    }
}

function createScannedDirectory(
    code: IVsCode,
    uri: vscode.Uri,
    root: vscode.Uri,
    fileNames: ReadonlySet<string>,
    token: vscode.CancellationToken | undefined,
): ScannedDirectory {
    const fileUri = (name: string) => code.Uri.joinPath(uri, name);
    const read = async <T>(name: string, reader: (target: vscode.Uri) => Promise<T>) => {
        if (!fileNames.has(name)) {
            return undefined;
        }
        throwIfCancelled(token, 'walkWorkspace');
        return reader(fileUri(name));
    };

    return {
        uri,
        workspaceFolder: code.workspace.getWorkspaceFolder(uri),
        relativePath: relativePath(root, uri) || '.',
        fileNames,
        fileUri,
        text: name => read(name, target => readText(code, target)),
    };
}
