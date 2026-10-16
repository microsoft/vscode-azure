/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { dirname, ExternalError, ICodeContext, isFileNotFoundError, showSmartQuickPick } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { isAbsolute } from 'node:path';
import type * as vscode from 'vscode';
import { IWorkspaceViewDataTree } from '../services';
import { FunctionsHostFileTag } from '../tree/workspace/functions/FunctionsWorkspaceDataProvider';
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
        let project: vscode.Uri;
        if (typeof target === 'string' && target.startsWith(FunctionsProjectKeyPrefix)) {
            const node = this.tree.get(target);
            if (!isFunctionsProjectNode(node)) {
                throw new ExternalError(this.ctx.code.l10n.t('The Functions project is not available. Refresh the workspace view.'));
            }
            project = dirname(node.resourceUri);
        } else if (target) {
            project = typeof target === 'string'
                ? isAbsolute(target) ? this.ctx.code.Uri.file(target)
                    : folder ? this.ctx.code.Uri.joinPath(folder.uri, ...target.split(/[\\/]/)) : this.ctx.code.Uri.file(target)
                : target;
        } else {
            const projects = (await this.index.getIndex()).withTag(FunctionsHostFileTag)
                .map(dirname).filter(uri => !folder || this.ctx.code.workspace.getWorkspaceFolder(uri)?.uri.toString() === folder.uri.toString());
            if (!projects.length) {
                throw new ExternalError(this.ctx.code.l10n.t('No Functions project was found. Open a workspace containing host.json.'));
            }
            const remembered = this.ctx.extensionContext.workspaceState.get<string>('functions.lastDebugProject');
            project = projects.length === 1 ? projects[0] : (await showSmartQuickPick(this.ctx,
                projects.map(data => ({ label: data.fsPath, data })),
                { title: this.ctx.code.l10n.t('Select a Functions project'), isActiveItem: item => item.data.toString() === remembered },
            )).data;
        }
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
}
