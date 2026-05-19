/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FunctionAppLogicalType } from '@microsoft/vscode-azure-azutils';
import type { ITreeItem, ViewProvider } from '@microsoft/vscode-azure-utils';
import { IActionExecutor, ICodeContext } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { RevealInExplorer } from '../../../commands/RevealInExplorer';
import { IWorkspaceViewDataTree } from '../../../services';
import { combineContextValues } from '../../combineContextValues';
import { getResourceTypeIconUri } from '../../iconPath';
import { FunctionsProjectKeyPrefix, isFunctionsProjectNode, type FunctionsProjectNode } from '../WorkspaceNode';

/** View-layer provider for {@linkcode FunctionsProjectNode}s. */
@injectable()
export class FunctionsWorkspaceViewProvider implements ViewProvider<string> {
    public readonly isRoot = true;

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IWorkspaceViewDataTree) private readonly dataTree: IWorkspaceViewDataTree,
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
            .filter(child => isFunctionsProjectNode(child))
            .map(child => child.id);
    }

    /** @inheritdoc */
    public getTreeItem(key: string): ITreeItem {
        const node = this.dataTree.get(key);

        if (!isFunctionsProjectNode(node)) {
            throw new Error(`Functions workspace node with key ${key} not found in cache`);
        } else {
            this.executor.setTelProp('nodeType', node.type);
            return toFunctionsProjectTreeItem(this.ctx, node);
        }
    }
}

function toFunctionsProjectTreeItem(ctx: ICodeContext, node: FunctionsProjectNode): ITreeItem {
    const item = new ctx.code.TreeItem(node.label, ctx.code.TreeItemCollapsibleState.None);
    item.id = node.id;
    item.description = ctx.code.l10n.t('Azure Functions');
    item.iconPath = getResourceTypeIconUri(ctx, FunctionAppLogicalType);
    item.contextValue = combineContextValues(RevealInExplorer.ContextValue);
    item.tooltip = node.resourceUri.fsPath;
    return item;
}
