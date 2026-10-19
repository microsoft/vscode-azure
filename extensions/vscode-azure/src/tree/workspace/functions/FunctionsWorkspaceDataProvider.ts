/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    basename, DebounceScheduler, dirname, Disposable, EventEmitter, IActionExecutor, IDebounceScheduler, IVsCode, relativePath, Roots,
    type DataProvider, type DataProviderChangeEvent,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable, unmanaged } from 'inversify';
import type * as vscode from 'vscode';
import { IWorkspaceIndexService } from '../../../utils/workspaceIndex/WorkspaceIndexService';
import type { FunctionsProjectNode, WorkspaceNode } from '../WorkspaceNode';
import { isFunctionsProjectNode } from '../WorkspaceNode';
import { FunctionsProjectReader } from '../../../functions/FunctionsProjectReader';
import { LocalFunctionsHostTracker } from '../../../functions/host/LocalFunctionsHostTracker';
import { FunctionsBuildFileTag, FunctionsHostFileName, FunctionsHostFileTag, FunctionsMetadataFileTag } from '../../../functions/functionsDetector';

/** Data-layer provider for {@linkcode FunctionsProjectNode}s. */
@injectable()
export class FunctionsWorkspaceDataProvider implements DataProvider<WorkspaceNode>, Disposable {
    public readonly isRoot = true;
    private readonly changeEmitter = new EventEmitter<DataProviderChangeEvent<WorkspaceNode>>();
    public readonly onDidChange = this.changeEmitter.event;
    private readonly disposables: Disposable[] = [this.changeEmitter];
    private readonly pendingProjects = new Set<string>();
    private projects: FunctionsProjectNode[] = [];

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IWorkspaceIndexService) private readonly indexService: IWorkspaceIndexService,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(FunctionsProjectReader) private readonly reader: FunctionsProjectReader,
        @inject(LocalFunctionsHostTracker) hosts: LocalFunctionsHostTracker,
        @unmanaged() private readonly outputScheduler: IDebounceScheduler = new DebounceScheduler(250),
    ) {
        this.disposables.push(outputScheduler);
        this.disposables.push(hosts.onDidChange(folder => { this.refreshHostProject(folder); }));
        // String-glob watching reuses VS Code's watcher; include output directories themselves for deletion events.
        const watcher = code.workspace.createFileSystemWatcher('**/{bin,target,bin/**,target/**}');
        const changed = (uri: vscode.Uri) => { this.queueOutputRefresh(uri); };
        this.disposables.push(watcher, watcher.onDidCreate(changed), watcher.onDidChange(changed), watcher.onDidDelete(changed));
    }

    private refreshHostProject(folder: vscode.Uri): void {
        if (!this.projects.length) {
            this.changeEmitter.fire({ target: Roots });
            return;
        }
        for (const project of this.projects) {
            if (dirname(project.resourceUri).toString() === folder.toString()) {
                this.changeEmitter.fire({ target: project });
            }
        }
    }

    private queueOutputRefresh(uri: vscode.Uri): void {
        for (const project of this.projects) {
            const relative = relativePath(dirname(project.resourceUri), uri);
            if (relative && /^(?:bin|target)(?:\/|$)/.test(relative)) {
                this.pendingProjects.add(project.id);
            }
        }
        if (this.pendingProjects.size) {
            this.outputScheduler.debounce(() => { this.flushOutputRefreshes(); });
        }
    }

    private flushOutputRefreshes(): void {
        const changedProjects = this.projects.filter(project => this.pendingProjects.has(project.id));
        this.pendingProjects.clear();
        for (const project of changedProjects) {
            this.changeEmitter.fire({ target: project });
        }
    }

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is FunctionsProjectNode {
        return isFunctionsProjectNode(resource);
    }

    /** @inheritdoc */
    public async getChildren(resource?: WorkspaceNode): Promise<WorkspaceNode[]> {
        if (!resource) {
            return this.discoverProjects();
        }
        if (!isFunctionsProjectNode(resource)) {
            return [];
        }
        const index = await this.indexService.getIndex();
        const folder = dirname(resource.resourceUri);
        const files = index.withTag(FunctionsMetadataFileTag).filter(uri =>
            dirname(dirname(uri)).toString() === folder.toString()
            && !index.has(this.code.Uri.joinPath(dirname(uri), FunctionsHostFileName), FunctionsHostFileTag));
        const buildFiles = index.withTag(FunctionsBuildFileTag).filter(uri => dirname(uri).toString() === folder.toString());
        let compiled: 'java' | 'dotnet' | undefined;
        if (buildFiles.some(uri => basename(uri) === 'pom.xml')) {
            compiled = 'java';
        } else if (buildFiles.some(uri => basename(uri).endsWith('.csproj'))) {
            compiled = 'dotnet';
        }
        return this.reader.functions(resource, files, compiled);
    }

    private async discoverProjects(): Promise<FunctionsProjectNode[]> {
        const index = await this.indexService.getIndex();
        const projects: FunctionsProjectNode[] = [];
        for (const uri of index.withTag(FunctionsHostFileTag)) {
            const folder = this.code.workspace.getWorkspaceFolder(uri);
            if (!folder) {
                continue;
            }
            const projectFolder = dirname(uri);
            const relative = relativePath(folder.uri, projectFolder);
            const label = relative ? `${folder.name}/${relative}` : folder.name;
            projects.push(await this.reader.project(uri, label || basename(projectFolder)));
        }

        this.executor.output.debug(`[data] functions workspace: discovered=${projects.length}`);
        this.projects = projects;
        return projects;
    }

    /** Disposes output and host subscriptions when the workspace tree is released. */
    public dispose(): void {
        Disposable.disposeAll(this.disposables);
        this.pendingProjects.clear();
    }
}
