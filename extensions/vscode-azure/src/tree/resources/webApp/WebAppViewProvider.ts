/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, getNodeType, isGenericResource } from '@microsoft/vscode-azure-azutils';
import { IActionExecutor, ICodeContext, type ITreeItem, type ViewProvider } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureViewDataTree } from '../../../services';
import { WebAppSettingsAdapter } from '../../../settings/adapters/WebAppSettingsAdapter';
import { createGenericResourceTreeItem } from '../GenericAzureViewProvider';

/**
 * Presents Web App resources as expandable because their data provider contributes a settings node.
 */
@injectable()
export class WebAppViewProvider implements ViewProvider<string> {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IAzureViewDataTree) private readonly tree: IAzureViewDataTree,
        @inject(WebAppSettingsAdapter) private readonly settingsAdapter: WebAppSettingsAdapter,
    ) { }

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is string {
        if (typeof resource !== 'string' || !AzureNodeId.test(resource)) {
            return false;
        }

        const node = this.tree.get(resource);
        return !!node && isGenericResource(node) && this.settingsAdapter.canHandle(node);
    }

    /** @inheritdoc */
    public async getChildren(key: string): Promise<string[]> {
        const resource = this.tree.get(key);
        if (!resource || !isGenericResource(resource)) {
            return [];
        }

        this.executor.setTelProp('nodeType', getNodeType(resource));
        return (await this.tree.getChildren(resource)).map(child => AzureNodeId.from(child).toString());
    }

    /** @inheritdoc */
    public getTreeItem(key: string): ITreeItem {
        const resource = this.tree.get(key);
        if (!resource || !isGenericResource(resource)) {
            return new this.ctx.code.TreeItem(key);
        }

        this.executor.setTelProp('nodeType', getNodeType(resource));
        return createGenericResourceTreeItem(
            this.ctx,
            resource,
            key,
            this.ctx.code.TreeItemCollapsibleState.Collapsed,
        );
    }

    /** @inheritdoc */
    public getParent(key: string): string | undefined {
        return AzureNodeId.parse(key).parentNodeId()?.toString();
    }
}
