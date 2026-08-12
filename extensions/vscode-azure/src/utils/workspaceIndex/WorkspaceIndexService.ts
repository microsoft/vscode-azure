/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter, IDebounceScheduler, IVsCode, relativePath } from '@microsoft/vscode-azure-utils';
import { inject, injectable, multiInject, type ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';
import { defaultExcludedDirectories } from './walkWorkspace';
import { buildWorkspaceIndex } from './buildWorkspaceIndex';
import { IWorkspaceDetector, type WorkspaceDetector } from './WorkspaceDetector';
import type { WorkspaceIndex } from './WorkspaceIndex';

/** Quiet period before a burst of file events triggers a rebuild. */
export const rebuildDebounceMs = 500;

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
@injectable()
export class WorkspaceIndexService implements IWorkspaceIndexService, vscode.Disposable {
    private readonly changeEmitter = new EventEmitter<void>();
    private readonly disposables: vscode.Disposable[] = [this.changeEmitter];
    private index: Promise<WorkspaceIndex> | undefined;

    public readonly onDidChangeIndex = this.changeEmitter.event;

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @multiInject(IWorkspaceDetector) private readonly detectors: readonly WorkspaceDetector[],
        @inject(IDebounceScheduler) private readonly scheduler: IDebounceScheduler,
    ) {
        this.disposables.push(scheduler);

        for (const pattern of watchPatterns(detectors)) {
            this.disposables.push(this.watch(pattern));
        }
        this.disposables.push(
            code.workspace.onDidChangeWorkspaceFolders(() => { this.invalidate(); }),
        );
    }

    /** @inheritdoc */
    public async getIndex(token?: vscode.CancellationToken): Promise<WorkspaceIndex> {
        this.index ??= buildWorkspaceIndex(this.code, this.detectors, token);
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
        this.scheduler.debounce(() => { this.invalidate(); });
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
        const path = relativePath(folder.uri, uri) ?? '';
        return path
            .split('/')
            .slice(0, -1)
            .some(segment => defaultExcludedDirectories.has(segment.toLowerCase()));
    }

    private invalidate(): void {
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
