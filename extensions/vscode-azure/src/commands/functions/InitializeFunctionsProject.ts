/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CaselessSet, ExternalError, fileExists, ICodeContext, readText, Roots, showMessage, showSmartQuickPick, type ICaselessSetReader } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { findNodeAtLocation, getNodeValue } from 'jsonc-parser';
import type * as vscode from 'vscode';
import { ExtensionId } from '../../constants';
import { FunctionsProjectSelector } from '../../functions/FunctionsProjectSelector';
import { LocalFunctionSettings } from '../../functions/LocalFunctionSettings';
import { IWorkspaceViewDataTree } from '../../services';
import { FunctionsProjectKeyPrefix } from '../../tree/workspace/WorkspaceNode';
import { editJsonc, parseJsoncObject } from '../../utils/jsonc';
import type { ManagedCommand } from '../ManagedCommand';

const RuntimeRecommendations: ReadonlyMap<string, readonly string[]> = new Map([
    ['python', ['ms-python.python', 'ms-python.debugpy']],
    ['java', ['redhat.java', 'vscjava.vscode-java-debug']],
    ['dotnet-isolated', ['ms-dotnettools.csharp']],
    ['powershell', ['ms-vscode.PowerShell']],
    ['native', ['golang.Go']],
]);

/** Sets the project's worker runtime and adds the workspace extension recommendations that local debugging needs. */
@injectable()
export class InitializeFunctionsProject implements ManagedCommand {
    public static readonly ContextValue = 'initializeFunctionsProject';

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(FunctionsProjectSelector) private readonly projects: FunctionsProjectSelector,
        @inject(LocalFunctionSettings) private readonly settings: LocalFunctionSettings,
        @inject(IWorkspaceViewDataTree) private readonly tree: IWorkspaceViewDataTree,
    ) { }

    public async execute(target?: string | vscode.Uri): Promise<void> {
        const project = await this.projects.select(undefined, target);
        const runtime = await this.selectRuntime(project);
        const workspace = this.ctx.code.workspace.getWorkspaceFolder(project);
        if (!workspace) {
            throw new ExternalError(this.ctx.code.l10n.t('Open the Functions project in a workspace folder before initializing it.'));
        }
        const directory = this.ctx.code.Uri.joinPath(workspace.uri, '.vscode');
        await this.ctx.code.workspace.fs.createDirectory(directory);
        await this.addRecommendations(directory, runtime);
        this.tree.remove(`${FunctionsProjectKeyPrefix}${this.ctx.code.Uri.joinPath(project, 'host.json').toString()}`);
        this.tree.invalidate(Roots);
        await showMessage(this.ctx.code, this.ctx.code.l10n.t('Functions project initialized. Press F5 to debug it.'), {});
    }

    private async selectRuntime(project: vscode.Uri): Promise<string> {
        const goProject = await fileExists(this.ctx.code, this.ctx.code.Uri.joinPath(project, 'go.mod'));
        let runtime = (await this.settings.read(project)).values.get('FUNCTIONS_WORKER_RUNTIME')?.trim().toLowerCase();
        if (!runtime) {
            const runtimes = ['node', 'python', 'dotnet-isolated', 'java', 'powershell', 'custom'];
            if (goProject) {
                runtimes.push('native');
            }
            const items = runtimes.map(data => ({
                label: data === 'native' ? this.ctx.code.l10n.t('Go (native worker)') : data,
                data,
            }));
            const selected = await showSmartQuickPick(this.ctx, items, {
                title: this.ctx.code.l10n.t('Select the project worker runtime'),
            });
            runtime = selected.data;
            await this.settings.setWorkerRuntime(project, runtime);
        }
        if (runtime === 'native' && !goProject) {
            throw new ExternalError(this.ctx.code.l10n.t('Native worker initialization requires a Go Functions project with go.mod.'));
        }
        return runtime;
    }

    private async addRecommendations(directory: vscode.Uri, runtime: string): Promise<void> {
        const uri = this.ctx.code.Uri.joinPath(directory, 'extensions.json');
        if (this.ctx.code.workspace.textDocuments.some(doc => doc.uri.toString() === uri.toString() && doc.isDirty)) {
            throw new ExternalError(this.ctx.code.l10n.t('Save {0} before initializing the project.', uri.fsPath));
        }
        const text = await readText(this.ctx.code, uri) ?? '{}';
        const node = findNodeAtLocation(parseJsoncObject(this.ctx.code, text, uri.fsPath), ['recommendations']);
        const value: unknown = node ? getNodeValue(node) : [];
        if (!Array.isArray(value) || !value.every(entry => typeof entry === 'string')) {
            throw new ExternalError(this.ctx.code.l10n.t('extensions.json recommendations must be an array of extension IDs.'));
        }
        const existing: ICaselessSetReader = new CaselessSet(value);
        const additions = [ExtensionId, ...(RuntimeRecommendations.get(runtime) ?? [])].filter(id => !existing.has(id));
        if (node && !additions.length) {
            return;
        }
        let edited = text;
        if (!node) {
            edited = editJsonc(edited, ['recommendations'], additions);
        } else {
            for (const id of additions) {
                edited = editJsonc(edited, ['recommendations', -1], id);
            }
        }
        await this.ctx.code.workspace.fs.writeFile(uri, new TextEncoder().encode(edited));
    }
}
