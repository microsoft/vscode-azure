/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DebounceScheduler, Disposable, EventEmitter, IDebounceScheduler, IVsCode, relativePath } from '@microsoft/vscode-azure-utils';
import { inject, injectable, multiInject, unmanaged, type ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';
import { defaultExcludedDirectories } from './walkWorkspace';
import { buildWorkspaceIndex, updateWorkspaceIndex } from './buildWorkspaceIndex';
import { IWorkspaceDetector, type WorkspaceDetector } from './WorkspaceDetector';
import type { MutableWorkspaceIndex, WorkspaceIndex } from './WorkspaceIndex';

/** Quiet period before a burst of file events triggers a rebuild. */
const rebuildDebounceMs = 500;

/**
 * Everything, because a narrower glob is not cheaper and is less correct.
 *
 * VS Code only forwards a *string* glob's filtering to the extension host, so
 * the pattern does not reduce what crosses the process boundary, and deleting a
 * folder reports one event for the folder rather than one per file inside it.
 */
const watchPattern = '**';

/**
 * Matches a relative path that passes *through* an excluded directory.
 *
 * Derived from {@linkcode defaultExcludedDirectories} so the walk and the event
 * filter cannot disagree. The trailing `/` is what restricts this to
 * intermediate segments: an event for an excluded directory itself still counts,
 * because that directory appearing or disappearing does change the walk.
 */
const excludedPathPattern = new RegExp(
    `(?:^|/)(?:${[...defaultExcludedDirectories]
        .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|')})/`,
    'i'
);

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
 * Watching is deliberately cheap, and deliberately broad. The watcher is
 * created from a **string** glob, which VS Code satisfies from the recursive
 * watch it already runs per workspace folder rather than starting another one.
 * A string glob is never sent to the main process, so every workspace event
 * reaches the extension host whatever pattern is passed -- a narrower pattern
 * would only change which of those events reach *us*, while risking missed
 * deletions, because VS Code folds a deleted folder's contents into a single
 * event for the folder itself.
 *
 * Events are instead filtered here against the same exclusions the walk uses,
 * so one `npm install` does not rebuild the index thousands of times.
 *
 * Surviving events are debounced and then applied **incrementally**: each one
 * evicts the node it names -- its whole subtree, when it names a directory --
 * along with its parent, and re-inspects only what was evicted. A full rebuild
 * would be simpler, but the watcher fires for every file in the workspace, so
 * an ordinary edit would cost a whole walk.
 *
 * The pending set is drained under the debounce, so a burst that touches the
 * same directory repeatedly costs one update, and `onDidChangeIndex` only fires
 * when something the index records actually changed.
 */
@injectable()
export class WorkspaceIndexService implements IWorkspaceIndexService, Disposable {
    private readonly changeEmitter = new EventEmitter<void>();
    private readonly disposables: Disposable[] = [this.changeEmitter];
    private readonly pending = new Map<string, vscode.Uri>();
    private indexPromise: Promise<MutableWorkspaceIndex> | undefined;

    public readonly onDidChangeIndex = this.changeEmitter.event;

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @multiInject(IWorkspaceDetector) private readonly detectors: readonly WorkspaceDetector[],
        @unmanaged() private readonly scheduler: IDebounceScheduler = new DebounceScheduler(rebuildDebounceMs),
    ) {
        this.disposables.push(scheduler);

        // A string pattern reuses VS Code's existing workspace watch; a
        // RelativePattern would start an additional recursive watcher.
        const watcher = code.workspace.createFileSystemWatcher(watchPattern);
        const handle = (uri: vscode.Uri) => { this.onFileEvent(uri); };
        this.disposables.push(
            watcher.onDidCreate(handle),
            watcher.onDidChange(handle),
            watcher.onDidDelete(handle),
            watcher,
            code.workspace.onDidChangeWorkspaceFolders(() => { this.invalidate(); }),
        );
    }

    /** @inheritdoc */
    public async getIndex(token?: vscode.CancellationToken): Promise<WorkspaceIndex> {
        this.indexPromise ??= buildWorkspaceIndex(this.code, this.detectors, token);
        try {
            return await this.indexPromise;
        } catch (error) {
            // Never retain a failed or cancelled build, so the next caller retries.
            this.indexPromise = undefined;
            throw error;
        }
    }

    public dispose(): void {
        Disposable.disposeAll(this.disposables);
    }

    private onFileEvent(uri: vscode.Uri): void {
        if (!this.indexPromise || this.isExcluded(uri)) {
            return;
        }
        // Keyed by URI, so a burst of writes to one file costs one update.
        this.pending.set(uri.toString(), uri);
        this.scheduler.debounce(() => this.applyPending());
    }

    /**
     * Re-inspects everything the pending events touched.
     *
     * Failures discard the index rather than leaving it half-updated; the next
     * {@linkcode getIndex} rebuilds from scratch.
     */
    private async applyPending(): Promise<void> {
        const index = await this.indexPromise;
        const changes = [...this.pending.values()];
        this.pending.clear();
        if (!index || changes.length === 0) {
            return;
        }

        let changed = false;
        try {
            for (const uri of changes) {
                changed = await updateWorkspaceIndex(this.code, this.detectors, index, uri) || changed;
            }
        } catch {
            this.invalidate();
            return;
        }

        if (changed) {
            this.changeEmitter.fire();
        }
    }

    /**
     * Whether an event can be ignored without consulting the index.
     *
     * Only the cheap, synchronous checks live here: the path segments the walk
     * would never descend into.
     */
    private isExcluded(uri: vscode.Uri): boolean {
        const folder = this.code.workspace.getWorkspaceFolder(uri);
        if (!folder) {
            return true;
        }
        // Matched against the path *relative* to the folder, so a workspace
        // opened at, say, `~/build/site` is not excluded by its own path.
        return excludedPathPattern.test(relativePath(folder.uri, uri) ?? '');
    }

    /** Discards the index entirely, so the next read rebuilds from scratch. */
    private invalidate(): void {
        this.indexPromise = undefined;
        this.pending.clear();
        this.changeEmitter.fire();
    }
}
