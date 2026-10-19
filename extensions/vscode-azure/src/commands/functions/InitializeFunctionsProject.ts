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
import { FunctionsDebugType, isFunctionsDebugRuntime } from '../../functions/debug/functionsDebug';
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

/** Initializes local workspace recommendations and optionally adds a product launch configuration. */
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
        await this.offerLaunchConfiguration(directory, project, runtime);
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
        await this.append(this.ctx.code.Uri.joinPath(directory, 'extensions.json'), 'recommendations', value => {
            if (!Array.isArray(value) || !value.every(entry => typeof entry === 'string')) {
                throw new ExternalError(this.ctx.code.l10n.t('extensions.json recommendations must be an array of extension IDs.'));
            }
            const existing: ICaselessSetReader = new CaselessSet(value);
            return [ExtensionId, ...(RuntimeRecommendations.get(runtime) ?? [])].filter(id => !existing.has(id));
        });
    }

    private async offerLaunchConfiguration(directory: vscode.Uri, project: vscode.Uri, runtime: string): Promise<void> {
        if (!isFunctionsDebugRuntime(runtime)) {
            await showMessage(this.ctx.code, this.ctx.code.l10n.t(
                'Functions project initialized. Local debugging supports Node.js, Python, Java, PowerShell, .NET isolated, and native Go projects.',
            ), {});
            return;
        }
        const action = this.ctx.code.l10n.t('Add launch.json Configuration');
        const selected = await showMessage(this.ctx.code, this.ctx.code.l10n.t(
            'Functions project initialized. F5 works without launch.json. Add an optional configuration for customization or compound launches?',
        ), {}, action);
        if (selected !== action) {
            return;
        }
        await this.append(this.ctx.code.Uri.joinPath(directory, 'launch.json'), 'configurations', value => {
            if (!Array.isArray(value) || !value.every(isConfiguration)) {
                throw new ExternalError(this.ctx.code.l10n.t('launch.json configurations must be an array of configuration objects.'));
            }
            const exists = value.some(entry => entry.type === FunctionsDebugType && entry.projectPath === project.fsPath);
            return exists ? [] : [{
                name: this.ctx.code.l10n.t('Debug Azure Functions'),
                type: FunctionsDebugType,
                request: 'launch',
                projectPath: project.fsPath,
            }];
        });
    }

    private async append(uri: vscode.Uri, key: string, additions: (value: unknown) => readonly unknown[]): Promise<void> {
        if (this.ctx.code.workspace.textDocuments.some(doc => doc.uri.toString() === uri.toString() && doc.isDirty)) {
            throw new ExternalError(this.ctx.code.l10n.t('Save {0} before initializing the project.', uri.fsPath));
        }
        const defaultText = key === 'configurations' ? '{ "version": "0.2.0", "configurations": [] }' : '{}';
        const text = await readText(this.ctx.code, uri) ?? defaultText;
        const root = parseJsoncObject(this.ctx.code, text, uri.fsPath);
        const node = findNodeAtLocation(root, [key]);
        const value: unknown = node ? getNodeValue(node) : [];
        const entries = additions(value);
        if (node && !entries.length) {
            return;
        }
        let edited = text;
        if (!node) {
            edited = editJsonc(edited, [key], entries);
        } else {
            for (const entry of entries) {
                edited = editJsonc(edited, [key, -1], entry);
            }
        }
        await this.ctx.code.workspace.fs.writeFile(uri, new TextEncoder().encode(edited));
    }
}

function isConfiguration(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
