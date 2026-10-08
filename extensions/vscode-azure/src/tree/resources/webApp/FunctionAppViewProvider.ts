/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, getNodeType } from '@microsoft/vscode-azure-azutils';
import { IActionExecutor, ICodeContext, type ITreeItem, type ViewProvider } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { RefreshResourcesView } from '../../../commands/tree/RefreshResourcesView';
import { IAzureViewDataTree } from '../../../services';
import { combineContextValues, resourceContextValue } from '../../contextValueHelpers';
import { createGenericResourceTreeItem } from '../GenericAzureViewProvider';
import {
    FunctionAppVirtualTypes,
    isFunctionApp,
    isFunctionAppVirtualNode,
    type FunctionApp,
    type FunctionAppVirtualNode,
} from './FunctionApp';

/** Presents Function Apps and their remote function descendants without fetching presentation data. */
@injectable()
export class FunctionAppViewProvider implements ViewProvider<string> {
    /** Product marker, independent of any command capability. */
    public static readonly ContextValue = 'azureFunctionApp';
    /** State markers are present only when Azure has reported the corresponding state. */
    public static readonly RunningContextValue = 'azureFunctionAppRunning';
    public static readonly StoppedContextValue = 'azureFunctionAppStopped';
    /** Hosting marker for apps whose site metadata includes Flex Consumption configuration. */
    public static readonly FlexContextValue = 'azureFunctionAppFlex';
    /** Function state markers for remote function leaves. */
    public static readonly EnabledFunctionContextValue = 'azureFunctionEnabled';
    public static readonly DisabledFunctionContextValue = 'azureFunctionDisabled';

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IAzureViewDataTree) private readonly tree: IAzureViewDataTree,
    ) { }

    /** @inheritdoc */
    public canHandle(key: unknown): key is string {
        if (typeof key !== 'string' || !AzureNodeId.test(key)) {
            return false;
        }
        const resource = this.tree.get(key);
        return isFunctionApp(resource) || isFunctionAppVirtualNode(resource);
    }

    /** @inheritdoc */
    public async getChildren(key: string): Promise<string[]> {
        const resource = this.tree.get(key);
        if (!isFunctionApp(resource)
            && !(isFunctionAppVirtualNode(resource) && resource.virtualType === FunctionAppVirtualTypes.Functions)) {
            return [];
        }
        this.executor.setTelProp('nodeType', getNodeType(resource));
        return (await this.tree.getChildren(resource)).map(child => AzureNodeId.from(child).toString());
    }

    /** @inheritdoc */
    public getTreeItem(key: string): ITreeItem {
        const resource = this.tree.get(key);
        if (!isFunctionApp(resource) && !isFunctionAppVirtualNode(resource)) {
            throw new Error(this.ctx.code.l10n.t('The Function App tree item is not available. Refresh the resources view.'));
        }
        this.executor.setTelProp('nodeType', getNodeType(resource));
        return isFunctionApp(resource) ? this.appTreeItem(key, resource) : this.virtualTreeItem(key, resource);
    }

    /** @inheritdoc */
    public getParent(key: string): string | undefined {
        const resource = this.tree.get(key);
        if (isFunctionAppVirtualNode(resource)) {
            if (resource.virtualType === FunctionAppVirtualTypes.Function
                || (resource.virtualType === FunctionAppVirtualTypes.Invalid && resource.kind !== 'app')) {
                return AzureNodeId.from({
                    virtualType: FunctionAppVirtualTypes.Functions,
                    virtualPath: 'functions',
                    azureResource: resource.azureResource,
                }).toString();
            }
            return AzureNodeId.from(resource.azureResource).toString();
        }
        return AzureNodeId.parse(key).parentNodeId()?.toString();
    }

    private appTreeItem(key: string, app: FunctionApp): ITreeItem {
        const item = createGenericResourceTreeItem(this.ctx, app, key, this.ctx.code.TreeItemCollapsibleState.Collapsed);
        if (app.siteError !== undefined) {
            item.description = this.ctx.code.l10n.t('Invalid');
            item.tooltip = app.siteError;
            item.iconPath = new this.ctx.code.ThemeIcon('warning');
            item.contextValue = RefreshResourcesView.ContextValue;
            return item;
        }

        const description: string[] = [];
        const contexts = [FunctionAppViewProvider.ContextValue, RefreshResourcesView.ContextValue];
        const state = app.site?.state?.toLowerCase();
        if (state === 'stopped') {
            description.push(this.ctx.code.l10n.t('Stopped'));
            contexts.push(FunctionAppViewProvider.StoppedContextValue);
        } else if (state === 'running') {
            contexts.push(FunctionAppViewProvider.RunningContextValue);
        } else if (app.site?.state) {
            description.push(app.site.state);
        }
        if (app.site?.functionAppConfig) {
            description.push(this.ctx.code.l10n.t('Flex Consumption'));
            contexts.push(FunctionAppViewProvider.FlexContextValue);
        }
        if (app.site) {
            item.description = description.join(', ');
        }
        item.contextValue = resourceContextValue(app, ...contexts);
        return item;
    }

    private virtualTreeItem(key: string, node: FunctionAppVirtualNode): ITreeItem {
        const item = new this.ctx.code.TreeItem('', this.ctx.code.TreeItemCollapsibleState.None);
        item.id = key;
        item.contextValue = RefreshResourcesView.ContextValue;
        switch (node.virtualType) {
            case FunctionAppVirtualTypes.Functions:
                item.label = this.ctx.code.l10n.t('Functions');
                item.collapsibleState = this.ctx.code.TreeItemCollapsibleState.Collapsed;
                item.iconPath = new this.ctx.code.ThemeIcon('symbol-method');
                break;
            case FunctionAppVirtualTypes.Function: {
                item.label = node.functionName;
                const trigger = node.authLevel
                    ? this.ctx.code.l10n.t('{0} ({1})', node.triggerKind, node.authLevel)
                    : node.triggerKind;
                item.description = node.isDisabled ? this.ctx.code.l10n.t('{0}, Disabled', trigger) : trigger;
                item.tooltip = this.ctx.code.l10n.t(
                    'Trigger: {0}\nState: {1}',
                    trigger,
                    node.isDisabled ? this.ctx.code.l10n.t('Disabled') : this.ctx.code.l10n.t('Enabled'),
                );
                item.iconPath = new this.ctx.code.ThemeIcon('symbol-method',
                    node.isDisabled ? new this.ctx.code.ThemeColor('disabledForeground') : undefined);
                item.contextValue = combineContextValues(
                    RefreshResourcesView.ContextValue,
                    node.isDisabled ? FunctionAppViewProvider.DisabledFunctionContextValue : FunctionAppViewProvider.EnabledFunctionContextValue,
                );
                break;
            }
            case FunctionAppVirtualTypes.Invalid:
                item.label = node.kind === 'function'
                    ? node.sourceLabel ?? this.ctx.code.l10n.t('Invalid function')
                    : node.kind === 'app'
                        ? this.ctx.code.l10n.t('Unable to read Function App')
                        : this.ctx.code.l10n.t('Unable to list functions');
                item.description = this.ctx.code.l10n.t('Invalid');
                item.tooltip = node.error;
                item.iconPath = new this.ctx.code.ThemeIcon('warning');
                break;
        }
        return item;
    }
}
