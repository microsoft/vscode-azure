/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError, type IVsCode } from '@microsoft/vscode-azure-utils';
import ignore, { type Ignore } from 'ignore';
import type * as vscode from 'vscode';

/**
 * Directories skipped by default: generated output, dependency caches, and VCS
 * metadata. Skipping these is most of what makes a walk affordable, and it
 * matters most when scanning source files -- `**‍/*.cs` would otherwise hit
 * `bin`/`obj`, and `**‍/*.py` would hit `.venv`.
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

/**
 * Largest file {@linkcode ScannedDirectory.text} will read. Manifests and source
 * files are small; anything larger is far more likely to be generated output or
 * a binary than something worth parsing.
 */
const defaultMaxFileBytes = 1024 * 1024;

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

    /** Largest file {@linkcode ScannedDirectory.text} will read. */
    readonly maxFileBytes?: number;
}

/**
 * One directory reached by {@linkcode walkWorkspace}, with its immediate file
 * names and lazy, memoized reads of those files.
 *
 * Reads are deferred until a consumer asks for them and cached for the lifetime
 * of this object, so several consumers inspecting the same manifest in one walk
 * cost a single read.
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

    /** Contents of a file here, or `undefined` if absent or too large. */
    text(name: string): Promise<string | undefined>;

    /**
     * This node's parsed JSON contents, or `undefined` if absent, too large,
     * or malformed. Malformed files are reported as absent so a broken manifest
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
 * names and lazy reads.
 *
 * This is the shared substrate for workspace scanning: it owns traversal,
 * exclusions, `.gitignore`, bounds, cancellation, and read caching, while
 * leaving *what a directory means* entirely to the caller. Consumers with
 * different result shapes -- classifying a project from its manifests, or
 * extracting many definitions from source files -- use the same walk.
 *
 * Because it yields rather than collecting, several consumers can share a
 * single traversal by inspecting each directory in one loop, which is the
 * difference between one pass over the workspace and one pass per consumer.
 *
 * The walk is breadth-first, so shallower directories arrive first, and within a
 * directory entries are visited in name order so repeated walks agree.
 *
 * Symlinked *directories* are not descended into, since they can form cycles or
 * point outside the scope; symlinked *files* are still listed and readable,
 * because reading one is bounded and cannot loop.
 *
 * @throws {@linkcode CancellationError} when `token` is cancelled.
 *
 * @example
 * ```ts
 * const walk = walkWorkspace(code, token);
 * for await (const directory of walk) {
 *     if (directory.fileNames.has('host.json')) {
 *         projects.push(directory.uri);
 *     }
 * }
 * if (walk.truncated) { -- results may be incomplete -- }
 * ```
 */
export function walkWorkspace(
    code: IVsCode,
    token?: vscode.CancellationToken,
    options: WalkWorkspaceOptions = {},
): WorkspaceWalk {
    const excluded = options.excludeDirectories ?? defaultExcludedDirectories;
    const respectGitignore = options.respectGitignore ?? true;
    const maxEntries = options.maxEntries ?? 5000;
    const maxFileBytes = options.maxFileBytes ?? defaultMaxFileBytes;
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
        const pending: PendingDirectory[] = [{ uri: root, relativePath: '', ignoreScopes: [] }];
        let entriesVisited = 0;

        while (pending.length > 0) {
            throwIfCanceled(token);
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
                if (isFileNotFound(error)) {
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
                ? await loadIgnoreScopes(code, directory, entries, maxFileBytes, token)
                : [];
            const fileNames = new Set<string>();
            const subdirectories: string[] = [];

            for (const [name, type] of entries) {
                const relativePath = join(directory.relativePath, name);
                const isDirectory = (type & code.FileType.Directory) !== 0;
                if (isIgnored(relativePath, isDirectory, ignoreScopes)) {
                    continue;
                }

                if (isDirectory) {
                    const isSymbolicLink = (type & code.FileType.SymbolicLink) !== 0;
                    if (!isSymbolicLink && !excluded.has(name.toLowerCase())) {
                        subdirectories.push(name);
                    }
                } else if ((type & code.FileType.File) !== 0) {
                    fileNames.add(name);
                }
            }

            yield createScannedDirectory(code, directory, fileNames, maxFileBytes, token);

            for (const name of subdirectories) {
                pending.push({
                    uri: code.Uri.joinPath(directory.uri, name),
                    relativePath: join(directory.relativePath, name),
                    ignoreScopes,
                });
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

interface IgnoreScope {
    readonly path: string;
    readonly matcher: Ignore;
}

interface PendingDirectory {
    readonly uri: vscode.Uri;
    readonly relativePath: string;
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
    directory: PendingDirectory,
    fileNames: ReadonlySet<string>,
    maxFileBytes: number,
    token: vscode.CancellationToken | undefined,
): ScannedDirectory {
    // Reads are memoized here so multiple consumers sharing one walk -- or one
    // consumer checking several things -- read each file at most once.
    const textReads = new Map<string, Promise<string | undefined>>();
    const jsonReads = new Map<string, Promise<unknown>>();

    const fileUri = (name: string) => code.Uri.joinPath(directory.uri, name);

    const text = (name: string): Promise<string | undefined> => {
        let pending = textReads.get(name);
        if (!pending) {
            pending = fileNames.has(name)
                ? readBoundedText(code, fileUri(name), maxFileBytes, token)
                : Promise.resolve(undefined);
            textReads.set(name, pending);
        }
        return pending;
    };

    const json = (name: string): Promise<unknown> => {
        let pending = jsonReads.get(name);
        if (!pending) {
            pending = text(name).then(contents => {
                if (contents === undefined) {
                    return undefined;
                }
                try {
                    return JSON.parse(contents) as unknown;
                } catch (error) {
                    // Treat a malformed file as absent: it is usually a
                    // work-in-progress edit, not a reason to fail the walk.
                    if (error instanceof SyntaxError) {
                        return undefined;
                    }
                    throw error;
                }
            });
            jsonReads.set(name, pending);
        }
        return pending;
    };

    return {
        uri: directory.uri,
        workspaceFolder: code.workspace.getWorkspaceFolder(directory.uri),
        relativePath: directory.relativePath || '.',
        fileNames,
        fileUri,
        text,
        json,
    };
}

async function loadIgnoreScopes(
    code: IVsCode,
    directory: PendingDirectory,
    entries: readonly [string, vscode.FileType][],
    maxFileBytes: number,
    token: vscode.CancellationToken | undefined,
): Promise<readonly IgnoreScope[]> {
    const hasGitignore = entries.some(([name, type]) =>
        name === '.gitignore' && (type & code.FileType.File) !== 0);
    if (!hasGitignore) {
        return directory.ignoreScopes;
    }

    throwIfCanceled(token);
    const contents = await readBoundedText(
        code, code.Uri.joinPath(directory.uri, '.gitignore'), maxFileBytes, token);
    if (contents === undefined) {
        return directory.ignoreScopes;
    }

    // Scopes accumulate down the tree so a nested file layers over its parents,
    // which is what lets a child re-include something an ancestor ignored.
    return [...directory.ignoreScopes, { path: directory.relativePath, matcher: ignore().add(contents) }];
}

function isIgnored(relativePath: string, isDirectory: boolean, scopes: readonly IgnoreScope[]): boolean {
    let ignored = false;
    for (const scope of scopes) {
        const scopedPath = scope.path
            ? relativePath.startsWith(`${scope.path}/`) ? relativePath.slice(scope.path.length + 1) : undefined
            : relativePath;
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

async function readBoundedText(
    code: IVsCode,
    uri: vscode.Uri,
    maxFileBytes: number,
    token: vscode.CancellationToken | undefined,
): Promise<string | undefined> {
    throwIfCanceled(token);
    try {
        const stat = await code.workspace.fs.stat(uri);
        if (stat.size > maxFileBytes) {
            return undefined;
        }
        return new TextDecoder().decode(await code.workspace.fs.readFile(uri));
    } catch (error) {
        if (isFileNotFound(error)) {
            return undefined;
        }
        throw error;
    }
}

function join(parent: string, child: string): string {
    return parent ? `${parent}/${child}` : child;
}

function isFileNotFound(error: unknown): boolean {
    return error !== null && typeof error === 'object' && 'code' in error && error.code === 'FileNotFound';
}

function throwIfCanceled(token: vscode.CancellationToken | undefined): void {
    if (token?.isCancellationRequested) {
        throw new CancellationError();
    }
}
