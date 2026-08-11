/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';
import { Debouncer } from '../base/Debouncer';
import { EventEmitter } from '../vscode/EventEmitter';
import type { IVsCode } from '../vscode/IVsCode';
import { defaultProjectMarkers } from './defaultProjectDetectors';
import { findWorkspaceProjects, type FindWorkspaceProjectsOptions } from './findWorkspaceProjects';
import type { ProjectMarkers } from './ProjectDetector';
import type { WorkspaceProject, WorkspaceScanResult } from './WorkspaceProject';

/** Quiet period before a burst of file events triggers a rescan. */
const rescanDebounceMs = 500;

export const IWorkspaceProjectService: ServiceIdentifier<IWorkspaceProjectService> = Symbol.for('IWorkspaceProjectService');

/**
 * Keeps the set of workspace projects current, re-scanning when project-defining
 * files change.
 */
export interface IWorkspaceProjectService {
    /**
     * The current projects, scanning on first use and returning the retained
     * result afterwards. The result stays fresh via file watching, so callers
     * should not cache it themselves.
     */
    getProjects(token?: vscode.CancellationToken): Promise<readonly WorkspaceProject[]>;

    /** Fires when the project set changes. */
    readonly onDidChangeProjects: vscode.Event<void>;
}

/**
 * File-watching implementation of {@linkcode IWorkspaceProjectService}.
 *
 * Watching is deliberately cheap. The watcher is created from a **string** glob,
 * which VS Code satisfies from the recursive watch it already runs for every
 * workspace folder rather than starting another one (a `RelativePattern` would
 * start a new one). Events are then filtered against the exclusions and
 * `.gitignore` matchers retained by the last scan, because a marker glob such as
 * `**‍/package.json` also matches everything under `node_modules` -- without that
 * filter a single `npm install` would rebuild the project set thousands of times.
 *
 * Surviving events are debounced into one rescan. A full rescan is used rather
 * than patching individual directories because the walk is only tens of
 * milliseconds, and it keeps subtle cases -- an edited `.gitignore` re-including
 * a subtree, a deleted project root -- correct without extra bookkeeping.
 */
export class WorkspaceProjectService implements IWorkspaceProjectService, vscode.Disposable {
    private readonly changeEmitter = new EventEmitter<void>();
    private readonly debouncer = new Debouncer();
    private readonly disposables: vscode.Disposable[] = [this.changeEmitter, this.debouncer];
    private scan: Promise<WorkspaceScanResult> | undefined;

    public readonly onDidChangeProjects = this.changeEmitter.event;

    public constructor(
        private readonly code: IVsCode,
        private readonly options: FindWorkspaceProjectsOptions = {},
    ) {
        const markers = options.markers
            ? {
                names: new Set([...defaultProjectMarkers.names, ...options.markers.names]),
                suffixes: [...defaultProjectMarkers.suffixes, ...options.markers.suffixes],
            }
            : defaultProjectMarkers;

        this.disposables.push(
            this.watch(markerGlob(markers)),
            // A changed `.gitignore` can add or remove whole subtrees.
            this.watch('**/.gitignore'),
            code.workspace.onDidChangeWorkspaceFolders(() => { this.invalidate(); }),
        );
    }

    /** @inheritdoc */
    public async getProjects(token?: vscode.CancellationToken): Promise<readonly WorkspaceProject[]> {
        this.scan ??= findWorkspaceProjects(this.code, token, this.options);
        try {
            return (await this.scan).projects;
        } catch (error) {
            // Never retain a failed or cancelled scan, so the next caller retries.
            this.scan = undefined;
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
        // A string pattern reuses VS Code's existing workspace watch; passing a
        // RelativePattern here would spin up an additional recursive watcher.
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
        void this.shouldRescan(uri).then(shouldRescan => {
            if (shouldRescan) {
                this.debouncer.debounce(RescanKey, rescanDebounceMs, () => { this.invalidate(); });
            }
        });
    }

    private async shouldRescan(uri: vscode.Uri): Promise<boolean> {
        const workspaceFolder = this.code.workspace.getWorkspaceFolder(uri);
        if (!workspaceFolder || !this.scan) {
            return false;
        }

        let result: WorkspaceScanResult;
        try {
            result = await this.scan;
        } catch {
            return false;
        }

        const relativePath = relativeTo(workspaceFolder.uri, uri);
        return relativePath !== undefined && !result.isExcluded(workspaceFolder, relativePath);
    }

    private invalidate(): void {
        this.debouncer.cancel(RescanKey);
        this.scan = undefined;
        this.changeEmitter.fire();
    }
}

const RescanKey = Symbol('WorkspaceProjectService.rescan');

/** Builds a single VS Code glob matching every marker file. */
function markerGlob(markers: ProjectMarkers): string {
    const alternatives = [...markers.names, ...markers.suffixes.map(suffix => `*${suffix}`)];
    return `**/{${alternatives.join(',')}}`;
}

/** POSIX-style path of `uri` relative to `base`, or `undefined` if outside it. */
function relativeTo(base: vscode.Uri, uri: vscode.Uri): string | undefined {
    const basePath = base.path.replace(/\/$/, '');
    if (uri.path === basePath) {
        return '';
    }
    return uri.path.startsWith(`${basePath}/`) ? uri.path.slice(basePath.length + 1) : undefined;
}
