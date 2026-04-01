/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, getNodeType, isGenericResource, isVirtualResource, type VirtualResource } from '@microsoft/vscode-azure-azutils';
import type { ITreeItem, ViewProvider } from '@microsoft/vscode-azure-utils';
import { IActionExecutor, IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { OpenInPortal } from '../../../commands/OpenInPortal';
import { AddAppSetting } from '../../../commands/functionApp/AddAppSetting';
import { DeleteAppSetting } from '../../../commands/functionApp/DeleteAppSetting';
import { EditAppSetting } from '../../../commands/functionApp/EditAppSetting';
import { IAzureViewDataTree } from '../../../services';
import { combineContextValues } from '../../combineContextValues';
import { isFunctionApp } from './FunctionApp';

/**
 * View-layer provider for Azure Function Apps.
 *
 * Handles tree-item rendering for Function App nodes and their virtual
 * children (App Settings category, individual settings).
 */
@injectable()
export class FunctionAppViewProvider implements ViewProvider<string> {

    public static readonly ContextValue = 'functionApp';

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IAzureViewDataTree) private readonly cache: IAzureViewDataTree,
    ) { }

    // #region ViewProvider

    public canHandle(resource: unknown): resource is string {
        if (typeof resource !== 'string' || !AzureNodeId.test(resource)) {
            return false;
        }

        const node = this.cache.get(resource);
        return !!node && (isFunctionApp(node) || isFunctionAppVirtual(node));
    }

    public getTreeItem(key: string): ITreeItem {
        const resource = this.cache.get(key);
        if (!resource) {
            return new this.code.TreeItem(key);
        }

        this.executor.setTelProp('nodeType', getNodeType(resource));

        // Virtual sub-nodes (App Settings category and individual settings)
        if (isVirtualResource(resource) && resource.virtualType.startsWith('functionApp.')) {
            return this.getVirtualTreeItem(key, resource);
        }

        if (!isGenericResource(resource)) {
            throw new Error('Expected an Azure resource');
        }

        // Function App resource node
        const item = new this.code.TreeItem(resource.name, this.code.TreeItemCollapsibleState.Collapsed);
        item.id = key;
        item.contextValue = combineContextValues(OpenInPortal.ContextValue, FunctionAppViewProvider.ContextValue);
        item.iconPath = new this.code.ThemeIcon('symbol-event');
        item.description = resource.logicalType;

        return item;
    }

    public async getChildren(key?: string): Promise<string[]> {
        if (!key) {
            return [];
        }

        const resource = this.cache.get(key);
        if (!resource) {
            return [];
        }

        this.executor.setTelProp('nodeType', getNodeType(resource));

        const children = await this.cache.getChildren(resource);
        return children.map(child => AzureNodeId.from(child).toString());
    }

    public getParent(key: string): string | undefined {
        return AzureNodeId.parse(key).parentNodeId()?.toString();
    }

    // #endregion

    private getVirtualTreeItem(key: string, resource: VirtualResource): ITreeItem {
        const isCategory = resource.virtualType === 'functionApp.appSettings';
        const label = resource.virtualPath;

        const collapsibleState = isCategory
            ? this.code.TreeItemCollapsibleState.Collapsed
            : this.code.TreeItemCollapsibleState.None;

        const item = new this.code.TreeItem(label, collapsibleState);
        item.id = key;

        if (isCategory) {
            item.contextValue = combineContextValues('functionAppSettings', AddAppSetting.ContextValue);
            item.iconPath = new this.code.ThemeIcon('folder');
        } else {
            // Individual app setting
            item.contextValue = combineContextValues('functionAppSetting', EditAppSetting.ContextValue, DeleteAppSetting.ContextValue);
            item.iconPath = new this.code.ThemeIcon('symbol-key');
        }

        return item;
    }
}

function isFunctionAppVirtual(node: unknown): boolean {
    return isVirtualResource(node as VirtualResource) && isFunctionApp((node as VirtualResource).azureResource);
}
