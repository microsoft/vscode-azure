/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FunctionAppLogicalType } from '@microsoft/vscode-azure-azutils';
import type { ITreeItem, ViewProvider } from '@microsoft/vscode-azure-utils';
import { dirname, IActionExecutor, ICodeContext } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { RevealInExplorer } from '../../../commands/tree/RevealInExplorer';
import { RefreshWorkspaceView } from '../../../commands/tree/RefreshWorkspaceView';
import { CopyFunctionUrl } from '../../../commands/functions/CopyFunctionUrl';
import { DeployFunctionApp } from '../../../commands/functions/DeployFunctionApp';
import { DebugFunctionsProject } from '../../../commands/functions/DebugFunctionsProject';
import { InitializeFunctionsProject } from '../../../commands/functions/InitializeFunctionsProject';
import { ExecuteFunction } from '../../../commands/functions/ExecuteFunction';
import { SetFunctionState } from '../../../commands/functions/SetFunctionState';
import { LocalFunctionsHostTracker } from '../../../functions/host/LocalFunctionsHostTracker';
import { IWorkspaceViewDataTree } from '../../../services';
import { combineContextValues } from '../../contextValueHelpers';
import { getResourceTypeIconUri } from '../../iconPath';
import { FunctionsProjectKeyPrefix, isFunctionsProjectNode, isLocalFunctionsNode, isLocalFunctionNode, type FunctionsProjectNode, type LocalFunctionNode } from '../WorkspaceNode';
import { isFunctionsDebugRuntime } from '../../../functions/debug/FunctionsDebugPreparation';

/** Renders local Functions projects, their direct function leaves, and listing hints or errors. */
@injectable()
export class FunctionsWorkspaceViewProvider implements ViewProvider<string> {
    public readonly isRoot = true;

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IWorkspaceViewDataTree) private readonly dataTree: IWorkspaceViewDataTree,
        @inject(LocalFunctionsHostTracker) private readonly hosts: LocalFunctionsHostTracker,
    ) { }

    /** @inheritdoc */
    public canHandle(key: unknown): key is string {
        return typeof key === 'string' && key.startsWith(FunctionsProjectKeyPrefix);
    }

    /** @inheritdoc */
    public async getChildren(key?: string): Promise<string[]> {
        const parent = key ? this.dataTree.get(key) : undefined;
        if (key && !parent) {
            return [];
        }
        const children = await this.dataTree.getChildren(parent);
        return children
            .filter(child => parent ? isLocalFunctionsNode(child) : isFunctionsProjectNode(child))
            .map(child => child.id);
    }

    /** @inheritdoc */
    public getTreeItem(key: string): ITreeItem {
        const node = this.dataTree.get(key);

        if (!isFunctionsProjectNode(node) && !isLocalFunctionsNode(node)) {
            throw new Error(this.ctx.code.l10n.t('The Functions workspace item is not available. Refresh the workspace view.'));
        }
        this.executor.setTelProp('nodeType', node.type);
        const item = new this.ctx.code.TreeItem(node.label, isFunctionsProjectNode(node)
            ? this.ctx.code.TreeItemCollapsibleState.Collapsed : this.ctx.code.TreeItemCollapsibleState.None);
        item.id = node.id;
        item.contextValue = RefreshWorkspaceView.ContextValue;
        if (isFunctionsProjectNode(node)) {
            this.configureProjectItem(item, node);
        } else if (isLocalFunctionNode(node)) {
            this.configureFunctionItem(item, node);
        } else {
            item.description = node.error ? this.ctx.code.l10n.t('Invalid') : undefined;
            item.tooltip = node.error;
            item.iconPath = new this.ctx.code.ThemeIcon(node.error ? 'warning' : 'info');
        }
        return item;
    }

    private configureProjectItem(item: ITreeItem, node: FunctionsProjectNode): void {
        item.tooltip = node.error ?? node.resourceUri.fsPath;
        if (node.error) {
            item.description = this.ctx.code.l10n.t('Invalid');
            item.iconPath = new this.ctx.code.ThemeIcon('warning');
            return;
        }
        item.description = node.initialized === false
            ? this.ctx.code.l10n.t('Worker runtime not configured')
            : this.ctx.code.l10n.t('Azure Functions');
        item.iconPath = getResourceTypeIconUri(this.ctx, FunctionAppLogicalType);
        item.contextValue = combineContextValues(
            RevealInExplorer.ContextValue,
            RefreshWorkspaceView.ContextValue,
            DeployFunctionApp.ContextValue,
            InitializeFunctionsProject.ContextValue,
            isFunctionsDebugRuntime(node.runtime) ? DebugFunctionsProject.ContextValue : '',
        );
    }

    private configureFunctionItem(item: ITreeItem, node: LocalFunctionNode): void {
        const running = !!this.hosts.get(dirname(node.project.resourceUri));
        if (node.isDisabled) {
            item.description = this.ctx.code.l10n.t('{0}, Disabled', node.triggerKind);
        } else {
            item.description = node.authLevel
                ? this.ctx.code.l10n.t('{0} ({1})', node.triggerKind, node.authLevel)
                : node.triggerKind;
        }
        item.iconPath = new this.ctx.code.ThemeIcon('symbol-method',
            node.isDisabled ? new this.ctx.code.ThemeColor('disabledForeground') : undefined);
        item.contextValue = combineContextValues(
            RefreshWorkspaceView.ContextValue,
            node.isDisabled ? SetFunctionState.EnableContextValue : SetFunctionState.DisableContextValue,
            running ? ExecuteFunction.ContextValue : '',
            running && node.triggerKind.toLowerCase() === 'httptrigger' ? CopyFunctionUrl.ContextValue : '',
            node.resourceUri ? RevealInExplorer.ContextValue : '',
        );
    }

    /** Functions are direct project children even before view expansion has loaded them. */
    public getParent(key: string): string | undefined {
        const node = this.dataTree.get(key);
        return isLocalFunctionsNode(node) ? node.project.id : undefined;
    }
}
