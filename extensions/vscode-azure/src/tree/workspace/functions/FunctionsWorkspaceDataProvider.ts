/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    dirname, Disposable, EventEmitter, IActionExecutor, IVsCode, Roots,
    type DataProvider, type DataProviderChangeEvent,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import { IWorkspaceIndexService } from '../../../utils/workspaceIndex/WorkspaceIndexService';
import type { FunctionsProjectNode, WorkspaceNode } from '../WorkspaceNode';
import { isFunctionsProjectNode } from '../WorkspaceNode';
import { FunctionsProjectReader } from '../../../functions/FunctionsProjectReader';
import { LocalFunctionsHostTracker } from '../../../functions/host/LocalFunctionsHostTracker';
import { FunctionsHostFileTag } from '../../../functions/functionsDetector';

/** Data-layer provider for {@linkcode FunctionsProjectNode}s. */
@injectable()
export class FunctionsWorkspaceDataProvider implements DataProvider<WorkspaceNode>, Disposable {
    public readonly isRoot = true;
    private readonly changeEmitter = new EventEmitter<DataProviderChangeEvent<WorkspaceNode>>();
    public readonly onDidChange = this.changeEmitter.event;
    private readonly disposables: Disposable[] = [this.changeEmitter];
    private projects: FunctionsProjectNode[] = [];

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IWorkspaceIndexService) private readonly indexService: IWorkspaceIndexService,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(FunctionsProjectReader) private readonly reader: FunctionsProjectReader,
        @inject(LocalFunctionsHostTracker) hosts: LocalFunctionsHostTracker,
    ) {
        this.disposables.push(hosts.onDidChange(folder => { this.refreshHostProject(folder); }));
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
        return this.reader.functions(resource);
    }

    private async discoverProjects(): Promise<FunctionsProjectNode[]> {
        const index = await this.indexService.getIndex();
        const projects: FunctionsProjectNode[] = [];
        for (const uri of index.withTag(FunctionsHostFileTag)) {
            if (!this.code.workspace.getWorkspaceFolder(uri)) {
                continue;
            }
            projects.push(await this.reader.project(uri));
        }

        this.executor.output.debug(`[data] functions workspace: discovered=${projects.length}`);
        this.projects = projects;
        return projects;
    }

    /** Disposes host subscriptions when the workspace tree is released. */
    public dispose(): void {
        Disposable.disposeAll(this.disposables);
    }
}
