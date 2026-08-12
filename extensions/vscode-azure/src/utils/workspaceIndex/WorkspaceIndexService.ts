/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Debouncer, EventEmitter, type IVsCode } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';
import { defaultExcludedDirectories } from './walkWorkspace';
import { buildWorkspaceIndex, type BuildWorkspaceIndexOptions } from './buildWorkspaceIndex';
import type { WorkspaceDetector } from './WorkspaceDetector';
import type { WorkspaceIndex } from './WorkspaceIndex';

/** Quiet period before a burst of file events triggers a rebuild. */
const rebuildDebounceMs = 500;

const RebuildKey = Symbol('WorkspaceIndexService.rebuild');

export const IWorkspaceIndexService: ServiceIdentifier<IWorkspaceIndexService> = Symbol.for('IWorkspaceIndexService');

/** Keeps a {@linkcode WorkspaceIndex} current as the workspace changes. */
export interface IWorkspaceIndexService {
    /**
     * The current index, building it on first use and returning the retained
     * result afterwards. It is kept fresh by file watching, so callers should
     * hold the service rather than caching the index.
     */
    getIndex(token?: vscode.CancellationToken): Promise<WorkspaceIndex>;

    /** Fires when the index has been invalidated and should be re-read. */
    readonly onDidChangeIndex: vscode.Event<void>;
}

/**
 * File-watching implementation of {@linkcode IWorkspaceIndexService}.
 *
 * Nothing is scanned until the first {@linkcode getIndex} call, so registering
 * detectors costs nothing at activation.
 *
 * Watching is deliberately cheap. The watcher is created from a **string** glob
 * covering only the files detectors declared interest in, which VS Code
 * satisfies from the recursive watch it already runs per workspace folder
 * rather than starting another one. Events are then filtered against the
 * exclusions and `.gitignore` rules the last build saw, because a glob like
 * `**‍/package.json` also matches everything under `node_modules` -- without
 * that filter one `npm install` would rebuild the index thousands of times.
 *
 * Surviving events are debounced into a single **full** rebuild. Re-indexing
 * only the affected directory would be faster but is not sound in general:
 * `DetectorContext.ancestor` and cross-namespace reads let a tag depend on
 * state outside the directory that changed.
 */
export class WorkspaceIndexService implements IWorkspaceIndexService, vscode.Disposable {
    private readonly changeEmitter = new EventEmitter<void>();
    private readonly debouncer = new Debouncer();
    private readonly disposables: vscode.Disposable[] = [this.changeEmitter, this.debouncer];
    private index: Promise<WorkspaceIndex> | undefined;
    /** Directories excluded by the walk, used to drop uninteresting events. */
    private readonly excluded: ReadonlySet<string>;

    public readonly onDidChangeIndex = this.changeEmitter.event;

    public constructor(
        private readonly code: IVsCode,
        private readonly detectors: readonly WorkspaceDetector[],
        private readonly options: BuildWorkspaceIndexOptions = {},
    ) {
        this.excluded = options.excludeDirectories ?? defaultExcludedDirectories;

        const patterns = watchPatterns(detectors);
        for (const pattern of patterns) {
            this.disposables.push(this.watch(pattern));
        }
        this.disposables.push(
            code.workspace.onDidChangeWorkspaceFolders(() => { this.invalidate(); }),
        );
    }

    /** @inheritdoc */
    public async getIndex(token?: vscode.CancellationToken): Promise<WorkspaceIndex> {
        this.index ??= buildWorkspaceIndex(this.code, this.detectors, token, this.options);
        try {
            return await this.index;
        } catch (error) {
            // Never retain a failed or cancelled build, so the next caller retries.
            this.index = undefined;
            throw error;
        }
    }

    public dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables.length = 0;
    }

    private watch(pattern: string): vscode.Disposable {
        // A string pattern reuses VS Code's existing workspace watch; a
        // RelativePattern would start an additional recursive watcher.
        const watcher = this.code.workspace.createFileSystemWatcher(pattern);
        const handle = (uri: vscode.Uri) => { this.onFileEvent(uri); };
        const subscriptions = [
            watcher.onDidCreate(handle),
            watcher.onDidChange(handle),
            watcher.onDidDelete(handle),
        ];

        return {
            dispose: () => {
                for (const subscription of subscriptions) {
                    subscription.dispose();
                }
                watcher.dispose();
            },
        };
    }

    private onFileEvent(uri: vscode.Uri): void {
        if (!this.index || this.isExcluded(uri)) {
            return;
        }
        this.debouncer.debounce(RebuildKey, rebuildDebounceMs, () => { this.invalidate(); });
    }

    /**
     * Whether an event can be ignored without consulting the index.
     *
     * Only the cheap, synchronous checks live here: the path segments the walk
     * would never descend into. Anything the walk skipped for a `.gitignore`
     * reason costs at most one redundant rebuild.
     */
    private isExcluded(uri: vscode.Uri): boolean {
        const folder = this.code.workspace.getWorkspaceFolder(uri);
        if (!folder) {
            return true;
        }
        const relativePath = uri.path.slice(folder.uri.path.replace(/\/$/, '').length + 1);
        return relativePath
            .split('/')
            .slice(0, -1)
            .some(segment => this.excluded.has(segment.toLowerCase()));
    }

    private invalidate(): void {
        this.debouncer.cancel(RebuildKey);
        this.index = undefined;
        this.changeEmitter.fire();
    }
}

/**
 * Glob patterns covering everything the detectors asked to see.
 *
 * Kept as narrow as the declared interests allow so VS Code discards most
 * events before the extension is woken for them.
 */
export function watchPatterns(detectors: readonly WorkspaceDetector[]): readonly string[] {
    const alternatives = new Set<string>();
    for (const detector of detectors) {
        for (const name of detector.files?.names ?? []) {
            alternatives.add(name);
        }
        for (const suffix of detector.files?.suffixes ?? []) {
            alternatives.add(`*${suffix}`);
        }
    }

    const patterns: string[] = [];
    if (alternatives.size > 0) {
        patterns.push(`**/{${[...alternatives].sort().join(',')}}`);
    }
    // A changed `.gitignore` can add or remove whole subtrees, and directory
    // detectors have no file interest that would otherwise cover it.
    patterns.push('**/.gitignore');
    return patterns;
}
