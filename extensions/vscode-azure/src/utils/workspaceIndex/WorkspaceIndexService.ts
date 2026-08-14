/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DebounceScheduler, Disposable, EventEmitter, IDebounceScheduler, IVsCode, relativePath } from '@microsoft/vscode-azure-utils';
import { inject, injectable, multiInject, unmanaged, type ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';
import { defaultExcludedDirectories } from './walkWorkspace';
import { buildWorkspaceIndex } from './buildWorkspaceIndex';
import { IWorkspaceDetector, type WorkspaceDetector } from './WorkspaceDetector';
import type { WorkspaceIndex } from './WorkspaceIndex';

/** Quiet period before a burst of file events triggers a rebuild. */
const rebuildDebounceMs = 500;

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
 * rather than starting another one. Events are then filtered against the same
 * exclusions the walk uses, because a glob like `**‍/package.json` also matches
 * everything under `node_modules` -- without that filter one `npm install`
 * would rebuild the index thousands of times.
 *
 * Surviving events are debounced into a single **full** rebuild. Re-indexing
 * only the affected directory would be faster but is not sound in general:
 * cross-namespace reads let one detector's tag depend on another's findings
 * outside the directory that changed.
 */
@injectable()
export class WorkspaceIndexService implements IWorkspaceIndexService, Disposable {
    private readonly changeEmitter = new EventEmitter<void>();
    private readonly disposables: Disposable[] = [this.changeEmitter];
    private indexPromise: Promise<WorkspaceIndex> | undefined;

    public readonly onDidChangeIndex = this.changeEmitter.event;

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @multiInject(IWorkspaceDetector) private readonly detectors: readonly WorkspaceDetector[],
        @unmanaged() private readonly scheduler: IDebounceScheduler = new DebounceScheduler(rebuildDebounceMs),
    ) {
        this.disposables.push(scheduler);

        const pattern = watchPattern(detectors);
        if (pattern) {
            // A string pattern reuses VS Code's existing workspace watch; a
            // RelativePattern would start an additional recursive watcher.
            const watcher = code.workspace.createFileSystemWatcher(pattern);
            const handle = (uri: vscode.Uri) => { this.onFileEvent(uri); };
            this.disposables.push(
                watcher.onDidCreate(handle),
                watcher.onDidChange(handle),
                watcher.onDidDelete(handle),
                watcher,
            );
        }
        this.disposables.push(
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
        this.scheduler.debounce(() => { this.invalidate(); });
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
        const path = relativePath(folder.uri, uri) ?? '';
        return path
            .split('/')
            .slice(0, -1)
            .some(segment => defaultExcludedDirectories.has(segment.toLowerCase()));
    }

    private invalidate(): void {
        this.indexPromise = undefined;
        this.changeEmitter.fire();
    }
}

/**
 * A single glob covering every file the detectors asked to see, or `undefined`
 * if none did.
 *
 * Kept as narrow as the declared interests allow so VS Code discards most
 * events before the extension is notified of them. A detector that declares no
 * file interest contributes nothing: it is asking to see directories, and a
 * directory only appears or disappears along with the files inside it.
 */
export function watchPattern(detectors: readonly WorkspaceDetector[]): string | undefined {
    const alternatives = new Set<string>();
    for (const detector of detectors) {
        for (const name of detector.files?.names ?? []) {
            alternatives.add(name);
        }
        for (const suffix of detector.files?.suffixes ?? []) {
            alternatives.add(`*${suffix}`);
        }
    }

    const sorted = [...alternatives].sort();
    if (sorted.length === 0) {
        return undefined;
    }
    // A one-element brace list is not an alternation -- `{host.json}` matches
    // that literal name, braces included -- so only brace two or more.
    return sorted.length === 1 ? `**/${sorted[0]}` : `**/{${sorted.join(',')}}`;
}
