/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { dirname, ExternalError, ICodeContext, isFileNotFoundError, showSmartQuickPick } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { isAbsolute } from 'node:path';
import type * as vscode from 'vscode';
import { IWorkspaceViewDataTree } from '../services';
import { FunctionsHostFileTag } from './functionsDetector';
import { FunctionsProjectKeyPrefix, isFunctionsProjectNode } from '../tree/workspace/WorkspaceNode';
import { IWorkspaceIndexService } from '../utils/workspaceIndex/WorkspaceIndexService';

/** Selects an indexed project or an explicit project in a trusted local workspace. */
@injectable()
export class FunctionsProjectSelector {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IWorkspaceIndexService) private readonly index: IWorkspaceIndexService,
        @inject(IWorkspaceViewDataTree) private readonly tree: IWorkspaceViewDataTree,
    ) { }

    public assertLocal(project: vscode.Uri): void {
        if (!this.ctx.code.workspace.isTrusted || project.scheme !== 'file' || !this.ctx.code.workspace.getWorkspaceFolder(project)) {
            throw new ExternalError(this.ctx.code.l10n.t('Functions development requires a project in a trusted, non-virtual workspace folder.'));
        }
    }

    public async select(folder?: vscode.WorkspaceFolder, target?: string | vscode.Uri): Promise<vscode.Uri> {
        let project = this.resolveTarget(folder, target) ?? await this.pickProject(folder);
        this.assertLocal(project);
        const host = this.ctx.code.Uri.joinPath(project, 'host.json');
        try {
            await this.ctx.code.workspace.fs.stat(host);
        } catch (error) {
            if (isFileNotFoundError(error)) {
                throw new ExternalError(this.ctx.code.l10n.t('The selected Functions project does not contain host.json. Select a folder containing host.json.'));
            }
            throw error;
        }
        if (process.platform === 'win32') {
            project = (await this.index.getIndex()).withTag(FunctionsHostFileTag).map(dirname)
                .find(uri => uri.toString().toLowerCase() === project.toString().toLowerCase()) ?? project;
        }
        await this.ctx.extensionContext.workspaceState.update('functions.lastDebugProject', project.toString());
        return project;
    }

    private resolveTarget(folder?: vscode.WorkspaceFolder, target?: string | vscode.Uri): vscode.Uri | undefined {
        if (!target) {
            return undefined;
        }
        if (typeof target !== 'string') {
            return target;
        }
        if (target.startsWith(FunctionsProjectKeyPrefix)) {
            const node = this.tree.get(target);
            if (!isFunctionsProjectNode(node)) {
                throw new ExternalError(this.ctx.code.l10n.t('The Functions project is not available. Refresh the workspace view.'));
            }
            return dirname(node.resourceUri);
        }
        if (!isAbsolute(target) && folder) {
            return this.ctx.code.Uri.joinPath(folder.uri, ...target.split(/[\\/]/));
        }
        return this.ctx.code.Uri.file(target);
    }

    private async pickProject(folder?: vscode.WorkspaceFolder): Promise<vscode.Uri> {
        const projects = (await this.index.getIndex()).withTag(FunctionsHostFileTag)
            .map(dirname).filter(uri => !folder || this.ctx.code.workspace.getWorkspaceFolder(uri)?.uri.toString() === folder.uri.toString());
        if (!projects.length) {
            throw new ExternalError(this.ctx.code.l10n.t('No Functions project was found. Open a workspace containing host.json.'));
        }
        if (projects.length === 1) {
            return projects[0];
        }
        const remembered = this.ctx.extensionContext.workspaceState.get<string>('functions.lastDebugProject');
        const selected = await showSmartQuickPick(this.ctx, projects.map(data => ({ label: data.fsPath, data })), {
            title: this.ctx.code.l10n.t('Select a Functions project'),
            isActiveItem: item => item.data.toString() === remembered,
        });
        return selected.data;
    }
}
