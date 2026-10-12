/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExternalError, fileExists, ICodeContext, readText, Roots, showMessage, showSmartQuickPick } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { applyEdits, findNodeAtLocation, getNodeValue, modify, parseTree } from 'jsonc-parser';
import type * as vscode from 'vscode';
import { ExtensionId } from '../../constants';
import { FunctionsProjectSelector } from '../../functions/FunctionsProjectSelector';
import { LocalFunctionSettings } from '../../functions/LocalFunctionSettings';
import { isFunctionsDebugRuntime } from '../../functions/debug/FunctionsDebugPreparation';
import { FunctionsDebugProvider } from '../../functions/debug/FunctionsDebugProvider';
import { IWorkspaceViewDataTree } from '../../services';
import { FunctionsProjectKeyPrefix } from '../../tree/workspace/WorkspaceNode';
import type { ManagedCommand } from '../ManagedCommand';

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
        const goProject = await fileExists(this.ctx.code, this.ctx.code.Uri.joinPath(project, 'go.mod'));
        let runtime = (await this.settings.read(project)).values.FUNCTIONS_WORKER_RUNTIME?.trim().toLowerCase();
        if (!runtime) {
            runtime = (await showSmartQuickPick(this.ctx, ['node', 'python', 'dotnet-isolated', 'java', 'powershell', 'custom', ...(goProject ? ['native'] : [])]
                .map(data => ({ label: data === 'native' ? this.ctx.code.l10n.t('Go (native worker)') : data, data })),
            { title: this.ctx.code.l10n.t('Select the project worker runtime') })).data;
            await this.settings.setWorkerRuntime(project, runtime);
        }
        if (runtime === 'native' && !goProject) {
            throw new ExternalError(this.ctx.code.l10n.t('Native worker initialization requires a Go Functions project with go.mod.'));
        }
        const recommendations: Record<string, readonly string[]> = {
            node: [], python: ['ms-python.python', 'ms-python.debugpy'], java: ['redhat.java', 'vscjava.vscode-java-debug'],
            ['dotnet-isolated']: ['ms-dotnettools.csharp'], powershell: ['ms-vscode.PowerShell'], custom: [], native: ['golang.Go'],
        };
        const workspace = this.ctx.code.workspace.getWorkspaceFolder(project);
        if (!workspace) { throw new ExternalError(this.ctx.code.l10n.t('Open the Functions project in a workspace folder before initializing it.')); }
        const directory = this.ctx.code.Uri.joinPath(workspace.uri, '.vscode');
        await this.ctx.code.workspace.fs.createDirectory(directory);
        await this.append(this.ctx.code.Uri.joinPath(directory, 'extensions.json'), 'recommendations', value => {
            if (!Array.isArray(value) || !value.every(entry => typeof entry === 'string')) {
                throw new ExternalError(this.ctx.code.l10n.t('extensions.json recommendations must be an array of extension IDs.'));
            }
            return [ExtensionId, ...(recommendations[runtime] ?? [])].filter(id => !value.includes(id));
        });
        this.tree.remove(`${FunctionsProjectKeyPrefix}${this.ctx.code.Uri.joinPath(project, 'host.json').toString()}`);
        this.tree.invalidate(Roots);
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
        if (selected === action) {
            await this.append(this.ctx.code.Uri.joinPath(directory, 'launch.json'), 'configurations', value => {
                if (!Array.isArray(value) || !value.every(isConfiguration)) {
                    throw new ExternalError(this.ctx.code.l10n.t('launch.json configurations must be an array of configuration objects.'));
                }

                const exists = value.some(entry => entry.type === FunctionsDebugProvider.Type && entry.projectPath === project.fsPath);
                return exists ? [] : [{
                    name: this.ctx.code.l10n.t('Debug Azure Functions'), type: FunctionsDebugProvider.Type, request: 'launch', projectPath: project.fsPath,
                }];
            });
        }
    }

    private async append(uri: vscode.Uri, key: string, additions: (value: unknown) => readonly unknown[]): Promise<void> {
        if (this.ctx.code.workspace.textDocuments.some(doc => doc.uri.toString() === uri.toString() && doc.isDirty)) {
            throw new ExternalError(this.ctx.code.l10n.t('Save {0} before initializing the project.', uri.fsPath));
        }
        const text = await readText(this.ctx.code, uri) ?? (key === 'configurations' ? '{ "version": "0.2.0", "configurations": [] }' : '{}');
        const errors: { error: number; offset: number; length: number }[] = [];
        const root = parseTree(text, errors, { allowTrailingComma: true });
        if (errors.length || root?.type !== 'object') {
            throw new ExternalError(this.ctx.code.l10n.t('{0} must contain a valid JSON object.', uri.fsPath));
        }
        const properties = (root.children ?? []).map(property => property.children?.[0].value as unknown);
        if (new Set(properties).size !== properties.length) {
            throw new ExternalError(this.ctx.code.l10n.t('{0} must not contain duplicate properties.', uri.fsPath));
        }
        const node = findNodeAtLocation(root, [key]);
        const value: unknown = node ? getNodeValue(node) : [];
        const entries = additions(value);
        if (node && !entries.length) { return; }
        const options = { formattingOptions: { tabSize: 4, insertSpaces: true, eol: text.includes('\r\n') ? '\r\n' : '\n' } };
        let edited = text;
        if (!node) {
            edited = applyEdits(edited, modify(edited, [key], entries, options));
        } else {
            for (const entry of entries) {
                edited = applyEdits(edited, modify(edited, [key, -1], entry, options));
            }
        }
        await this.ctx.code.workspace.fs.writeFile(uri, new TextEncoder().encode(edited));
    }
}

function isConfiguration(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
