/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isFileNotFoundError, readJson, readText, relativePath, throwIfCancelled, type IVsCode } from '@microsoft/vscode-azure-utils';
import ignore, { type Ignore } from 'ignore';
import type * as vscode from 'vscode';

/**
 * Directories skipped by default: generated output, dependency caches, and VCS
 * metadata. Skipping these is most of what makes a walk affordable, and it
 * matters most when scanning source files -- a `.cs` sweep would otherwise hit
 * `bin`/`obj`, and a `.py` sweep would hit `.venv`.
 *
 * Spread this when adding to it rather than replacing it wholesale.
 */
export const defaultExcludedDirectories: ReadonlySet<string> = new Set([
    '.git', '.hg', '.svn',
    'node_modules', 'bower_components', 'vendor',
    'bin', 'obj', 'target', 'build', 'dist', 'out',
    '.next', '.nuxt', '.output', '.svelte-kit',
    '.venv', 'venv', '__pycache__', '.tox',
    '.gradle', '.terraform', 'coverage',
]);

/** Options for {@linkcode walkWorkspace}. */
export interface WalkWorkspaceOptions {
    /**
     * Where to walk. A {@linkcode vscode.Uri Uri} restricts the walk to that
     * subtree (e.g. a single project), which is usually what a consumer working
     * inside a known project wants. Defaults to every open workspace folder.
     */
    readonly scope?: vscode.Uri | readonly vscode.WorkspaceFolder[];

    /** Directory names never descended into. Defaults to {@linkcode defaultExcludedDirectories}. */
    readonly excludeDirectories?: ReadonlySet<string>;

    /** Whether `.gitignore` files are honoured. Defaults to `true`. */
    readonly respectGitignore?: boolean;

    /**
     * Directory entries to visit per scope root before the walk stops descending
     * and sets {@linkcode WorkspaceWalk.truncated}. Directories already read are
     * still reported, so a budget shrinks how deep the walk goes rather than
     * discarding results.
     */
    readonly maxEntries?: number;
}

/**
 * One directory reached by {@linkcode walkWorkspace}, with its immediate file
 * names and reads of those files.
 */
export interface ScannedDirectory {
    readonly uri: vscode.Uri;
    /** The containing workspace folder, if this directory is inside one. */
    readonly workspaceFolder: vscode.WorkspaceFolder | undefined;
    /** POSIX-style path relative to the scope root, or `.` for the root itself. */
    readonly relativePath: string;
    /** Names of the files directly inside this directory. */
    readonly fileNames: ReadonlySet<string>;

    /** The {@linkcode vscode.Uri Uri} of a file in this directory. */
    fileUri(name: string): vscode.Uri;

    /** Full contents of a file here, or `undefined` if it is not present. */
    text(name: string): Promise<string | undefined>;

    /**
     * Parsed JSON contents of a file here, or `undefined` if absent or
     * malformed. Malformed files are reported as absent so a broken manifest
     * cannot abort a walk.
     */
    json(name: string): Promise<unknown>;
}

/**
 * The directories reached by a walk, plus whether it stopped early.
 *
 * {@linkcode truncated} is only meaningful once iteration has finished, and
 * reflects the most recent iteration.
 */
export interface WorkspaceWalk extends AsyncIterable<ScannedDirectory> {
    readonly truncated: boolean;
}

/**
 * Walks the workspace (or one subtree), yielding each directory with its file
 * names and reads.
 *
 * **Internal to the workspace index.** It is the traversal engine behind
 * `buildWorkspaceIndex` -- owning exclusions, `.gitignore`, bounds and
 * cancellation -- and is kept separate because those concerns are testable and
 * changeable independently of tagging. Product code should go through
 * `IWorkspaceIndexService` instead, so that one walk and one watcher serve
 * every consumer.
 *
 * The walk is breadth-first, so shallower directories arrive first, and within a
 * directory entries are visited in name order so repeated walks agree.
 *
 * Symlinked *directories* are not descended into, since they can form cycles or
 * point outside the scope; symlinked *files* are still listed and readable,
 * because reading one cannot loop.
 *
 * @throws {@linkcode CancellationError} when `token` is cancelled.
 */
export function walkWorkspace(
    code: IVsCode,
    token?: vscode.CancellationToken,
    options: WalkWorkspaceOptions = {},
): WorkspaceWalk {
    const excluded = options.excludeDirectories ?? defaultExcludedDirectories;
    const respectGitignore = options.respectGitignore ?? true;
    const maxEntries = options.maxEntries ?? 5000;
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
        throw new RangeError('maxEntries must be a positive integer');
    }

    const roots = resolveRoots(code, options.scope);
    const walk = {
        truncated: false,
        async *[Symbol.asyncIterator](): AsyncIterator<ScannedDirectory> {
            // Reset so a re-iteration reports its own outcome rather than
            // inheriting truncation from an earlier pass.
            walk.truncated = false;
            for (const root of roots) {
                yield* walkRoot(root);
            }
        },
    };

    return walk;

    async function* walkRoot(root: vscode.Uri): AsyncIterable<ScannedDirectory> {
        const pending: PendingDirectory[] = [{ uri: root, ignoreScopes: [] }];
        let entriesVisited = 0;

        while (pending.length > 0) {
            throwIfCancelled(token, 'walkWorkspace');
            // Breadth-first: shallower directories are reported before deeper ones.
            const directory = pending.shift();
            if (!directory) {
                break;
            }

            let entries: [string, vscode.FileType][];
            try {
                entries = await code.workspace.fs.readDirectory(directory.uri);
            } catch (error) {
                // A directory disappearing mid-walk is an expected race; anything
                // else (permissions, provider failure) is worth surfacing.
                if (isFileNotFoundError(error)) {
                    continue;
                }
                throw error;
            }

            entriesVisited += entries.length;

            // The filesystem gives no ordering guarantee, so sort for a stable
            // walk: consumers building a tree would otherwise see children
            // reorder between refreshes.
            entries.sort(([left], [right]) => left.localeCompare(right));

            const ignoreScopes = respectGitignore
                ? await loadIgnoreScopes(code, directory, entries, token)
                : [];
            const fileNames = new Set<string>();
            const subdirectories: vscode.Uri[] = [];

            for (const [name, type] of entries) {
                const entryUri = code.Uri.joinPath(directory.uri, name);
                const isDirectory = (type & code.FileType.Directory) !== 0;
                if (isIgnored(entryUri, isDirectory, ignoreScopes)) {
                    continue;
                }

                if (isDirectory) {
                    const isSymbolicLink = (type & code.FileType.SymbolicLink) !== 0;
                    if (!isSymbolicLink && !excluded.has(name.toLowerCase())) {
                        subdirectories.push(entryUri);
                    }
                } else if ((type & code.FileType.File) !== 0) {
                    fileNames.add(name);
                }
            }

            yield createScannedDirectory(code, directory.uri, root, fileNames, token);

            for (const uri of subdirectories) {
                pending.push({ uri, ignoreScopes });
            }

            // Enforce the budget only after reporting this directory. It has
            // already been read, so dropping it would waste that work and could
            // hide the very manifest the caller came for -- a wide root would
            // otherwise yield nothing at all. Truncation means "there was more
            // to walk", so it is reported only when something is still queued.
            if (entriesVisited >= maxEntries && pending.length > 0) {
                walk.truncated = true;
                return;
            }
        }
    }
}

/**
 * A `.gitignore` and the directory it governs.
 *
 * Matching is delegated to the `ignore` package, which expects paths relative
 * to that directory; {@linkcode relativePath} produces them, so nothing here
 * interprets ignore syntax itself.
 */
interface IgnoreScope {
    readonly directoryUri: vscode.Uri;
    readonly matcher: Ignore;
}

interface PendingDirectory {
    readonly uri: vscode.Uri;
    readonly ignoreScopes: readonly IgnoreScope[];
}

function resolveRoots(
    code: IVsCode,
    scope: WalkWorkspaceOptions['scope'],
): readonly vscode.Uri[] {
    if (!scope) {
        return (code.workspace.workspaceFolders ?? []).map(folder => folder.uri);
    }
    return Array.isArray(scope)
        ? (scope as readonly vscode.WorkspaceFolder[]).map(folder => folder.uri)
        : [scope as vscode.Uri];
}

function createScannedDirectory(
    code: IVsCode,
    uri: vscode.Uri,
    root: vscode.Uri,
    fileNames: ReadonlySet<string>,
    token: vscode.CancellationToken | undefined,
): ScannedDirectory {
    const fileUri = (name: string) => code.Uri.joinPath(uri, name);

    const text = async (name: string): Promise<string | undefined> => {
        if (!fileNames.has(name)) {
            return undefined;
        }
        throwIfCancelled(token, 'walkWorkspace');
        return readText(code, fileUri(name));
    };

    return {
        uri,
        workspaceFolder: code.workspace.getWorkspaceFolder(uri),
        relativePath: relativePath(root, uri) || '.',
        fileNames,
        fileUri,
        text,
        json: async name => {
            if (!fileNames.has(name)) {
                return undefined;
            }
            throwIfCancelled(token, 'walkWorkspace');
            return readJson(code, fileUri(name));
        },
    };
}

async function loadIgnoreScopes(
    code: IVsCode,
    directory: PendingDirectory,
    entries: readonly [string, vscode.FileType][],
    token: vscode.CancellationToken | undefined,
): Promise<readonly IgnoreScope[]> {
    const hasGitignore = entries.some(([name, type]) =>
        name === '.gitignore' && (type & code.FileType.File) !== 0);
    if (!hasGitignore) {
        return directory.ignoreScopes;
    }

    throwIfCancelled(token, 'walkWorkspace');
    const contents = await readText(code, code.Uri.joinPath(directory.uri, '.gitignore'));
    if (contents === undefined) {
        return directory.ignoreScopes;
    }

    // Scopes accumulate down the tree so a nested file layers over its parents,
    // which is what lets a child re-include something an ancestor ignored.
    return [...directory.ignoreScopes, {
        directoryUri: directory.uri,
        matcher: ignore().add(contents),
    }];
}

function isIgnored(
    uri: vscode.Uri,
    isDirectory: boolean,
    scopes: readonly IgnoreScope[],
): boolean {
    let ignored = false;
    for (const scope of scopes) {
        const scopedPath = relativePath(scope.directoryUri, uri);
        if (!scopedPath) {
            continue;
        }
        // The trailing slash tells `ignore` this is a directory, which patterns
        // written as `build/` depend on.
        const result = scope.matcher.test(isDirectory ? `${scopedPath}/` : scopedPath);
        if (result.ignored) {
            ignored = true;
        } else if (result.unignored) {
            ignored = false;
        }
    }
    return ignored;
}
