/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, getNodeType } from '@microsoft/vscode-azure-azutils';
import {
    IActionExecutor,
    ICodeContext,
    type ITreeItem,
    type ViewProvider,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import { BrowseWebsite } from '../../../commands/tree/BrowseWebsite';
import { DeleteStaticWebAppEnvironment } from '../../../commands/staticWebApps/DeleteStaticWebAppEnvironment';
import { ShowFunctionsDocumentation } from '../../../commands/staticWebApps/ShowDocumentation';
import { ViewStaticWebAppProperties } from '../../../commands/staticWebApps/ViewStaticWebAppProperties';
import { OpenInPortal } from '../../../commands/tree/OpenInPortal';
import { IAzureViewDataTree } from '../../../services';
import { combineContextValues, resourceContextValue } from '../../contextValueHelpers';
import { getResourceTypeIconUri } from '../../iconPath';
import {
    isStaticWebApp,
    isStaticWebAppVirtualNode,
    StaticWebAppVirtualTypes,
    type InvalidStaticWebAppNode,
    type StaticWebApp,
    type StaticWebAppEnvironment,
    type StaticWebAppVirtualNode,
} from './StaticWebApp';

const showFunctionsDocumentationCommand = 'vscode-azure/staticWebApps/showFunctionsDocumentation';

/** View-layer renderer for Azure Static Web Apps and all virtual descendants. */
@injectable()
export class StaticWebAppViewProvider implements ViewProvider<string> {
    /** Context value retained for command and menu compatibility. */
    public static readonly ContextValue = 'azureStaticWebApp';

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IAzureViewDataTree) private readonly cache: IAzureViewDataTree,
    ) { }

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is string {
        if (typeof resource !== 'string' || !AzureNodeId.test(resource)) {
            return false;
        }
        const node = this.cache.get(resource);
        return !!node && (isStaticWebApp(node) || isStaticWebAppVirtualNode(node));
    }

    /** @inheritdoc */
    public getTreeItem(key: string): ITreeItem {
        const resource = this.cache.get(key);
        if (!resource) {
            return new this.ctx.code.TreeItem(key);
        }

        this.executor.setTelProp('nodeType', getNodeType(resource));
        if (isStaticWebApp(resource)) {
            return this.getSiteTreeItem(key, resource);
        } else if (isStaticWebAppVirtualNode(resource)) {
            return this.getVirtualTreeItem(key, resource);
        }
        throw new Error('Expected an Azure Static Web Apps resource');
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
        const children = await this.cache.getChildren(resource);
        return children.map(child => AzureNodeId.from(child).toString());
    }

    private getSiteTreeItem(key: string, site: StaticWebApp): ITreeItem {
        const item = new this.ctx.code.TreeItem(site.name, this.ctx.code.TreeItemCollapsibleState.Collapsed);
        item.id = key;
        // The shared helper contributes what every Azure resource node gets --
        // Open in Portal and Delete -- so deleting a static web app is the one
        // generic implementation rather than a product-specific copy of it.
        item.contextValue = resourceContextValue(
            site,
            StaticWebAppViewProvider.ContextValue,
            BrowseWebsite.ContextValue,
        );
        item.iconPath = getResourceTypeIconUri(this.ctx, site.logicalType);
        return item;
    }

    private getVirtualTreeItem(key: string, node: StaticWebAppVirtualNode): ITreeItem {
        switch (node.virtualType) {
            case StaticWebAppVirtualTypes.Environment:
                return this.getEnvironmentTreeItem(key, node);
            case StaticWebAppVirtualTypes.Functions:
                return this.treeItem(
                    key,
                    this.ctx.code.l10n.t('Functions'),
                    combineContextValues('azureStaticFunctions', OpenInPortal.ContextValue),
                    true,
                    'list-unordered',
                );
            case StaticWebAppVirtualTypes.Function:
                return this.treeItem(key, node.functionName, 'azureStaticFunction', false, 'symbol-function');
            case StaticWebAppVirtualTypes.NoFunctions:
                return this.getNoFunctionsTreeItem(key, node.kind);
            case StaticWebAppVirtualTypes.Invalid:
                return this.getInvalidTreeItem(key, node);
        }
    }

    private getEnvironmentTreeItem(key: string, environment: StaticWebAppEnvironment): ITreeItem {
        const item = this.treeItem(
            key,
            environment.displayLabel,
            combineContextValues(
                'azureStaticEnvironment',
                BrowseWebsite.ContextValue,
                DeleteStaticWebAppEnvironment.ContextValue,
                ViewStaticWebAppProperties.ContextValue,
            ),
            true,
            'server-environment',
        );
        if (environment.status && environment.status !== 'Ready') {
            item.description = environment.branch
                ? this.ctx.code.l10n.t('{0} ({1})', environment.branch, environment.status)
                : environment.status;
        } else if (environment.branch) {
            item.description = environment.branch;
        }
        return item;
    }

    private getNoFunctionsTreeItem(key: string, kind: 'help' | 'empty'): ITreeItem {
        if (kind === 'empty') {
            return this.treeItem(
                key,
                this.ctx.code.l10n.t('No Functions have been pushed to this Static Web App.'),
                combineContextValues('noFunctions', ShowFunctionsDocumentation.ContextValue),
                false,
                'info',
            );
        }

        const item = this.treeItem(
            key,
            this.ctx.code.l10n.t('Learn how to add an API with Azure Functions...'),
            combineContextValues('noFunctions', ShowFunctionsDocumentation.ContextValue),
            false,
            'book',
        );
        item.command = this.command(
            showFunctionsDocumentationCommand,
            this.ctx.code.l10n.t('Show Azure Functions Documentation'),
            key,
        );
        return item;
    }

    private getInvalidTreeItem(key: string, invalid: InvalidStaticWebAppNode): ITreeItem {
        return this.treeItem(key, invalid.displayLabel, invalid.invalidContextValue, false, 'warning');
    }

    private treeItem(
        key: string,
        label: string,
        contextValue: string,
        collapsible: boolean,
        icon?: string,
    ): ITreeItem {
        const state = collapsible
            ? this.ctx.code.TreeItemCollapsibleState.Collapsed
            : this.ctx.code.TreeItemCollapsibleState.None;
        const item = new this.ctx.code.TreeItem(label, state);
        item.id = key;
        item.contextValue = contextValue;
        if (icon) {
            item.iconPath = new this.ctx.code.ThemeIcon(icon);
        }
        return item;
    }

    private command(command: string, title: string, key: string): vscode.Command {
        return { command, title, arguments: [key] };
    }
}
