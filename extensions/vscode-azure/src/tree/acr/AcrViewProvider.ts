/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, isGenericResource, isVirtualResource } from '@microsoft/vscode-azure-azutils';
import type { ViewProvider } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import * as vscode from 'vscode';
import { IAzureResourceTreeCache } from '../../services';
import { isAcrRegistry } from './AcrRegistry';

/**
 * View-layer provider for Azure Container Registries.
 *
 * Handles tree-item rendering for ACR registry nodes, customising the
 * icon, description, and context value so that ACR-specific commands can
 * be scoped via `when` clauses.
 *
 * Before enrichment completes the node is rendered with a generic label;
 * once {@link AcrDataProvider.enrich} has run and the tree fires
 * `onDidChange`, this provider re-renders the item with the full details.
 */
@injectable()
export class AcrViewProvider implements ViewProvider<string> {

    public constructor(
        @inject(IAzureResourceTreeCache) private readonly cache: IAzureResourceTreeCache,
    ) { }

    // #region ViewProvider

    public canHandle(resource: unknown): resource is string {
        if (typeof resource !== 'string' || !AzureNodeId.test(resource)) {
            return false;
        }

        const node = this.cache.get(resource);
        return !!node && (isAcrRegistry(node) || (isVirtualResource(node) && isAcrRegistry(node.azureResource)));
    }

    public getTreeItem(key: string): vscode.TreeItem {
        const resource = this.cache.get(key);
        if (!resource) {
            return new vscode.TreeItem(key);
        }

        // Virtual sub-nodes (categories and leaf items)
        if (isVirtualResource(resource) && resource.virtualType.startsWith('acr.')) {
            const label = resource.virtualPath;

            // Categories share their virtualType with their children,
            // but categories are the ones that match the category label
            const isCategory = isCategoryNode(resource);
            const collapsibleState = isCategory
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None;

            const item = new vscode.TreeItem(label, collapsibleState);
            item.id = key;
            item.contextValue = isCategory ? 'acrCategory' : 'acrItem';
            item.iconPath = isCategory
                ? new vscode.ThemeIcon('folder')
                : new vscode.ThemeIcon('symbol-misc');
            return item;
        }

        if (!isGenericResource(resource)) {
            return new vscode.TreeItem(key);
        }

        // Collapsed since we have children
        const item = new vscode.TreeItem(resource.name, vscode.TreeItemCollapsibleState.Collapsed);
        item.id = key;
        item.contextValue = 'azureContainerRegistry';
        item.iconPath = new vscode.ThemeIcon('package');

        if (isAcrRegistry(resource)) {
            item.description = resource.type;

            if (resource.adminUserEnabled === true) {
                item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
                item.tooltip = 'Admin user is enabled. This is a security risk and is not recommended for production registries.';
            }
        }

        return item;
    }

    /**
     * No children yet — will return repository nodes once the data-plane
     * integration is in place.
     */
    /**
     * Get children by delegating to the data-layer cache, then converting
     * the returned resources to their string keys.
     */
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

    // #endregion
}

const categoryLabels = new Set(['Repositories', 'Webhooks']);

/**
 * A category node is a virtual resource whose `virtualPath` is one of
 * the known category labels (e.g. "Repositories", "Webhooks").
 */
function isCategoryNode(resource: import('@microsoft/vscode-azure-azutils').VirtualResource): boolean {
    return categoryLabels.has(resource.virtualPath);
}
