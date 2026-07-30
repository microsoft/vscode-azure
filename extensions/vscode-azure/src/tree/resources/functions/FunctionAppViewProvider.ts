/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, FunctionAppLogicalType, getNodeType, isGenericResource, type VirtualResource } from '@microsoft/vscode-azure-azutils';
import type { ITreeItem, ViewProvider } from '@microsoft/vscode-azure-utils';
import { IActionExecutor, ICodeContext } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { AddOrEditAppSetting } from '../../../commands/functions/AddOrEditAppSetting';
import { DeleteAppSetting } from '../../../commands/functions/DeleteAppSetting';
import { OpenInPortal } from '../../../commands/tree/OpenInPortal';
import { IAzureViewDataTree } from '../../../services';
import { combineContextValues } from '../../combineContextValues';
import { getResourceTypeIconUri } from '../../iconPath';
import type { ResourceTypePresentation } from '../ResourceTypePresentation';
import { FunctionAppVirtualTypes, isFunctionApp, isFunctionAppVirtual } from './FunctionApp';

/**
 * View-layer provider for Azure Function Apps.
 *
 * Handles tree-item rendering for Function App nodes and their virtual
 * children (App Settings category, individual settings).
 */
@injectable()
export class FunctionAppViewProvider implements ViewProvider<string> {
    /** Presentation metadata for Function App resource-type groups. */
    public static readonly resourceTypePresentation: ResourceTypePresentation = {
        logicalType: FunctionAppLogicalType,
        getDisplayName: code => code.l10n.t('Function Apps'),
    };

    /** Context value applied to Function App tree items. */
    public static readonly ContextValue = 'functionApp';

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IAzureViewDataTree) private readonly cache: IAzureViewDataTree,
    ) { }

    // #region ViewProvider

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is string {
        if (typeof resource !== 'string' || !AzureNodeId.test(resource)) {
            return false;
        }

        const node = this.cache.get(resource);
        return !!node && (isFunctionApp(node) || isFunctionAppVirtual(node));
    }

    /**
     * @inheritdoc
     * @throws if a non-virtual resource is passed that is not a {@linkcode GenericResource}.
     */
    public getTreeItem(key: string): ITreeItem {
        const resource = this.cache.get(key);
        if (!resource) {
            return new this.ctx.code.TreeItem(key);
        }

        this.executor.setTelProp('nodeType', getNodeType(resource));

        // Virtual sub-nodes (App Settings category and individual settings)
        if (isFunctionAppVirtual(resource)) {
            return this.getVirtualTreeItem(key, resource);
        }

        if (!isGenericResource(resource)) {
            throw new Error('Expected an Azure resource');
        }

        // Function App resource node
        const item = new this.ctx.code.TreeItem(resource.name, this.ctx.code.TreeItemCollapsibleState.Collapsed);
        item.id = key;
        item.contextValue = combineContextValues(OpenInPortal.ContextValue, FunctionAppViewProvider.ContextValue);
        item.iconPath = getResourceTypeIconUri(this.ctx, resource.logicalType);
        item.description = resource.logicalType;

        return item;
    }

    /** @inheritdoc */
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

    /** @inheritdoc */
    public getParent(key: string): string | undefined {
        return AzureNodeId.parse(key).parentNodeId()?.toString();
    }

    // #endregion

    private getVirtualTreeItem(key: string, resource: VirtualResource): ITreeItem {
        const isCategory = resource.virtualType === FunctionAppVirtualTypes.AppSettings;
        const label = isCategory
            ? this.ctx.code.l10n.t('App Settings')
            : resource.virtualPath;

        const collapsibleState = isCategory
            ? this.ctx.code.TreeItemCollapsibleState.Collapsed
            : this.ctx.code.TreeItemCollapsibleState.None;

        const item = new this.ctx.code.TreeItem(label, collapsibleState);
        item.id = key;

        if (isCategory) {
            item.contextValue = combineContextValues(AddOrEditAppSetting.AddContextValue);
            item.iconPath = new this.ctx.code.ThemeIcon('folder');
        } else {
            // Individual app setting
            item.contextValue = combineContextValues(AddOrEditAppSetting.EditContextValue, DeleteAppSetting.ContextValue);
            item.iconPath = new this.ctx.code.ThemeIcon('symbol-key');
        }

        return item;
    }
}
