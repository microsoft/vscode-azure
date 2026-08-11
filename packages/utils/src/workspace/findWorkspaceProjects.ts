/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ignore, { type Ignore } from 'ignore';
import type * as vscode from 'vscode';
import { CancellationError } from '../vscode/CancellationError';
import type { IVsCode } from '../vscode/IVsCode';
import { defaultProjectDetectors, defaultProjectMarkers } from './defaultProjectDetectors';
import { isProjectMarker, type ProjectDetection, type ProjectDetector, type ProjectDirectory, type ProjectMarkers } from './ProjectDetector';
import type { WorkspaceProject, WorkspaceScanResult } from './WorkspaceProject';

/** Options controlling workspace project discovery. */
export interface FindWorkspaceProjectsOptions {
    /** Defaults to all open workspace folders. */
    readonly workspaceFolders?: readonly vscode.WorkspaceFolder[];
    /** Appended to {@linkcode defaultProjectDetectors}. */
    readonly detectors?: readonly ProjectDetector[];
    /** Appended to {@linkcode defaultProjectMarkers}. */
    readonly markers?: ProjectMarkers;
    /** Directory entries to visit per workspace folder before giving up. */
    readonly maxEntries?: number;
}

/**
 * Entries visited per workspace folder before the walk stops and reports
 * {@linkcode WorkspaceScanResult.truncated}. Bounds a pathological tree without
 * needing separate depth or project caps.
 */
const defaultMaxEntries = 5000;

/**
 * Largest file read for evidence. Manifests are small; anything larger is far
 * more likely to be generated output than a config we can use.
 */
const maxEvidenceFileBytes = 1024 * 1024;

/**
 * Directories never worth walking. These are generated or vendored, and skipping
 * them is what keeps the walk cheap -- a `.gitignore` usually covers them too,
 * but not every repository has one.
 */
const excludedDirectories = new Set([
    '.git', '.next', '.output', '.svelte-kit', 'bin', 'build', 'coverage',
    'dist', 'node_modules', 'obj', 'out', 'public', 'target',
]);

interface IgnoreScope {
    readonly path: string;
    readonly matcher: Ignore;
}

interface PendingDirectory {
    readonly uri: vscode.Uri;
    readonly relativePath: string;
    readonly ignoreScopes: readonly IgnoreScope[];
}

/**
 * Finds candidate projects in the open workspace folders, classifying each with
 * {@linkcode defaultProjectDetectors}.
 *
 * The walk is breadth-first, so shallower projects are reported first. It never
 * follows directory symlinks, honours nested `.gitignore` files, and evaluates
 * each directory as it is enumerated rather than building a workspace-wide file
 * index.
 *
 * @throws {@linkcode CancellationError} when `token` is cancelled.
 */
export async function findWorkspaceProjects(
    code: IVsCode,
    token?: vscode.CancellationToken,
    options: FindWorkspaceProjectsOptions = {},
): Promise<WorkspaceScanResult> {
    throwIfCanceled(token);

    const folders = options.workspaceFolders ?? code.workspace.workspaceFolders ?? [];
    const detectors = [...defaultProjectDetectors, ...(options.detectors ?? [])];
    const markers = mergeMarkers(defaultProjectMarkers, options.markers);
    const maxEntries = options.maxEntries ?? defaultMaxEntries;
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
        throw new RangeError('maxEntries must be a positive integer');
    }

    const projects: WorkspaceProject[] = [];
    const ignoreScopesByFolder = new Map<string, readonly IgnoreScope[]>();
    let truncated = false;

    for (const workspaceFolder of folders) {
        const folderResult = await scanWorkspaceFolder(
            code, workspaceFolder, detectors, markers, maxEntries, token);
        projects.push(...folderResult.projects);
        ignoreScopesByFolder.set(workspaceFolder.uri.toString(), folderResult.ignoreScopes);
        truncated ||= folderResult.truncated;
    }

    return {
        projects,
        truncated,
        isExcluded: (workspaceFolder, relativePath) => {
            const normalized = relativePath.replace(/\\/g, '/').replace(/^\.?\//, '');
            if (normalized.split('/').some(segment => excludedDirectories.has(segment.toLowerCase()))) {
                return true;
            }
            const scopes = ignoreScopesByFolder.get(workspaceFolder.uri.toString()) ?? [];
            // Every scope discovered in the folder is tested; `isIgnored` skips
            // the ones that are not ancestors of this path.
            return isIgnored(normalized, false, scopes);
        },
    };
}

async function scanWorkspaceFolder(
    code: IVsCode,
    workspaceFolder: vscode.WorkspaceFolder,
    detectors: readonly ProjectDetector[],
    markers: ProjectMarkers,
    maxEntries: number,
    token: vscode.CancellationToken | undefined,
): Promise<{ projects: WorkspaceProject[]; truncated: boolean; ignoreScopes: readonly IgnoreScope[] }> {
    const projects: WorkspaceProject[] = [];
    const allIgnoreScopes: IgnoreScope[] = [];
    const pending: PendingDirectory[] = [{ uri: workspaceFolder.uri, relativePath: '', ignoreScopes: [] }];
    let entriesVisited = 0;
    let truncated = false;

    while (pending.length > 0) {
        throwIfCanceled(token);
        // Breadth-first: `shift()` keeps shallower directories ahead of deeper
        // ones, so a project at the root is always reported before its children.
        const directory = pending.shift();
        if (!directory) {
            break;
        }

        let entries: [string, vscode.FileType][];
        try {
            entries = await code.workspace.fs.readDirectory(directory.uri);
        } catch (error) {
            // A directory vanishing mid-walk is an expected race; anything else
            // (permissions, provider failure) is a real problem worth surfacing.
            if (isFileNotFound(error)) {
                continue;
            }
            throw error;
        }

        if (entriesVisited + entries.length > maxEntries) {
            truncated = true;
            break;
        }
        entriesVisited += entries.length;

        const ignoreScopes = await loadIgnoreScopes(code, directory, entries, token);
        if (ignoreScopes.length > directory.ignoreScopes.length) {
            // A new `.gitignore` was parsed here; retain it so incremental
            // consumers can reuse the compiled matcher.
            allIgnoreScopes.push(ignoreScopes[ignoreScopes.length - 1]);
        }
        const fileNames = new Set<string>();
        const subdirectories: string[] = [];

        for (const [name, type] of entries) {
            const relativePath = directory.relativePath ? `${directory.relativePath}/${name}` : name;
            const isDirectory = (type & code.FileType.Directory) !== 0;
            if (isIgnored(relativePath, isDirectory, ignoreScopes)) {
                continue;
            }

            if (isDirectory) {
                // Symlinked directories can point outside the workspace or form
                // cycles, so they are never followed.
                const isSymbolicLink = (type & code.FileType.SymbolicLink) !== 0;
                if (!isSymbolicLink && !excludedDirectories.has(name.toLowerCase())) {
                    subdirectories.push(name);
                }
            } else if ((type & code.FileType.File) !== 0) {
                fileNames.add(name);
            }
        }

        const isCandidate = [...fileNames].some(name => isProjectMarker(name, markers));
        if (isCandidate) {
            const project = await evaluateDirectory(
                code, workspaceFolder, directory, fileNames, detectors, projects, token);
            if (project) {
                projects.push(project);
            }
        }

        for (const name of subdirectories) {
            pending.push({
                uri: code.Uri.joinPath(directory.uri, name),
                relativePath: directory.relativePath ? `${directory.relativePath}/${name}` : name,
                ignoreScopes,
            });
        }
    }

    return { projects, truncated, ignoreScopes: allIgnoreScopes };
}

async function evaluateDirectory(
    code: IVsCode,
    workspaceFolder: vscode.WorkspaceFolder,
    directory: PendingDirectory,
    fileNames: ReadonlySet<string>,
    detectors: readonly ProjectDetector[],
    found: readonly WorkspaceProject[],
    token: vscode.CancellationToken | undefined,
): Promise<WorkspaceProject | undefined> {
    const context = createProjectDirectory(code, directory, fileNames);
    const frameworks: string[] = [];
    const buildTools: string[] = [];
    const languages: string[] = [];
    let outputDirectory: string | undefined;

    for (const detector of detectors) {
        throwIfCanceled(token);
        const detection: ProjectDetection | undefined = await detector(context);
        if (!detection) {
            continue;
        }
        addAll(frameworks, detection.frameworks);
        addAll(buildTools, detection.buildTools);
        addAll(languages, detection.languages);
        outputDirectory ??= normalizeProjectRelativePath(detection.outputDirectory);
    }

    if (frameworks.length === 0 && buildTools.length === 0 && languages.length === 0) {
        // Nothing recognised the directory. A bare `index.html` still marks a
        // static site, but only at a root no richer project already claimed --
        // otherwise every `src/index.html` inside an app becomes a "project".
        const nestedInProject = found.some(project => isAncestorPath(project.relativePath, directory.relativePath));
        if (!context.has('index.html') || nestedInProject) {
            return undefined;
        }
        frameworks.push('html');
        outputDirectory ??= '.';
    }

    return {
        workspaceFolder,
        rootUri: context.uri,
        relativePath: context.relativePath,
        frameworks,
        buildTools,
        languages,
        outputDirectory,
    };
}

function createProjectDirectory(
    code: IVsCode,
    directory: PendingDirectory,
    fileNames: ReadonlySet<string>,
): ProjectDirectory {
    // Several detectors read the same manifest, so reads are memoized per
    // directory. The maps live only for this directory's evaluation.
    const textReads = new Map<string, Promise<string | undefined>>();
    const jsonReads = new Map<string, Promise<unknown>>();

    const text = (name: string): Promise<string | undefined> => {
        let pending = textReads.get(name);
        if (!pending) {
            pending = fileNames.has(name)
                ? readBoundedText(code, code.Uri.joinPath(directory.uri, name))
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
                    // A malformed manifest is the user's work-in-progress, not a
                    // scan failure: treat it as absent.
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
        relativePath: directory.relativePath || '.',
        has: name => fileNames.has(name),
        findBySuffix: suffix => [...fileNames].find(name => name.endsWith(suffix)),
        text,
        json,
        hasDependency: async name => {
            const manifest = await json('package.json');
            if (manifest === null || typeof manifest !== 'object') {
                return false;
            }
            const { dependencies, devDependencies } = manifest as Record<string, unknown>;
            return hasStringProperty(dependencies, name) || hasStringProperty(devDependencies, name);
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

    throwIfCanceled(token);
    const contents = await readBoundedText(code, code.Uri.joinPath(directory.uri, '.gitignore'));
    if (contents === undefined) {
        return directory.ignoreScopes;
    }

    // Scopes accumulate down the tree so nested files layer over their parents,
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
        // A trailing slash tells `ignore` this is a directory, which matters for
        // patterns written as `build/`.
        const result = scope.matcher.test(isDirectory ? `${scopedPath}/` : scopedPath);
        if (result.ignored) {
            ignored = true;
        } else if (result.unignored) {
            ignored = false;
        }
    }
    return ignored;
}

async function readBoundedText(code: IVsCode, uri: vscode.Uri): Promise<string | undefined> {
    try {
        const stat = await code.workspace.fs.stat(uri);
        if (stat.size > maxEvidenceFileBytes) {
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

function mergeMarkers(base: ProjectMarkers, extra: ProjectMarkers | undefined): ProjectMarkers {
    if (!extra) {
        return base;
    }
    return {
        names: new Set([...base.names, ...extra.names]),
        suffixes: [...base.suffixes, ...extra.suffixes],
    };
}

function addAll(target: string[], values: readonly string[] | undefined): void {
    for (const value of values ?? []) {
        if (!target.includes(value)) {
            target.push(value);
        }
    }
}

function isAncestorPath(ancestor: string, descendant: string): boolean {
    return ancestor === '.' || descendant.startsWith(`${ancestor}/`);
}

/**
 * Normalizes a detector-supplied output path, rejecting anything that escapes
 * the project root. Configured paths come from user-controlled workspace files,
 * and consumers assume the result stays inside the project.
 */
function normalizeProjectRelativePath(path: string | undefined): string | undefined {
    if (path === undefined) {
        return undefined;
    }
    const normalized = path.replace(/\\/g, '/');
    if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)
        || normalized.split('/').includes('..')) {
        return undefined;
    }
    return normalized.replace(/^\.\//, '').replace(/\/$/, '') || '.';
}

function hasStringProperty(value: unknown, name: string): boolean {
    return value !== null && typeof value === 'object'
        && typeof (value as Record<string, unknown>)[name] === 'string';
}

function isFileNotFound(error: unknown): boolean {
    return error !== null && typeof error === 'object' && 'code' in error && error.code === 'FileNotFound';
}

function throwIfCanceled(token: vscode.CancellationToken | undefined): void {
    if (token?.isCancellationRequested) {
        throw new CancellationError();
    }
}
