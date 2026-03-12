/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, isGenericResource, isVirtualResource, type VirtualResource } from '@microsoft/vscode-azure-azutils';
import type { ITreeItem, ViewProvider } from '@microsoft/vscode-azure-utils';
import { IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { DisableAcrAdminUser } from '../../../commands/acr/DisableAcrAdminUser';
import { OpenInPortal } from '../../../commands/OpenInPortal';
import { IAzureViewDataTree } from '../../../services';
import { combineContextValues } from '../../combineContextValues';
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
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IAzureViewDataTree) private readonly cache: IAzureViewDataTree,
    ) { }

    // #region ViewProvider

    public canHandle(resource: unknown): resource is string {
        if (typeof resource !== 'string' || !AzureNodeId.test(resource)) {
            return false;
        }

        const node = this.cache.get(resource);
        return !!node && (isAcrRegistry(node) || (isVirtualResource(node) && isAcrRegistry(node.azureResource)));
    }

    public getTreeItem(key: string): ITreeItem {
        const resource = this.cache.get(key);
        if (!resource) {
            return new this.code.TreeItem(key);
        }

        // Virtual sub-nodes (categories and leaf items)
        if (isVirtualResource(resource) && resource.virtualType.startsWith('acr.')) {
            const label = resource.virtualPath;

            // Categories share their virtualType with their children,
            // but categories are the ones that match the category label
            const isCategory = isCategoryNode(resource);
            const collapsibleState = isCategory
                ? this.code.TreeItemCollapsibleState.Collapsed
                : this.code.TreeItemCollapsibleState.None;

            const item = new this.code.TreeItem(label, collapsibleState);
            item.id = key;
            item.contextValue = isCategory ? 'acrCategory' : 'acrItem';
            item.iconPath = isCategory
                ? new this.code.ThemeIcon('folder')
                : new this.code.ThemeIcon('symbol-misc');
            return item;
        }

        if (!isGenericResource(resource)) {
            throw new Error('Expected an Azure resource or virtual resource');
        }

        // Collapsed since we have children
        const item = new this.code.TreeItem(resource.name, this.code.TreeItemCollapsibleState.Collapsed);
        item.id = key;
        item.contextValue = combineContextValues(OpenInPortal.ContextValue, DisableAcrAdminUser.ContextValue);
        item.iconPath = new this.code.ThemeIcon('package');

        if (isAcrRegistry(resource)) {
            item.description = resource.logicalType;

            if (resource.adminUserEnabled === true) {
                item.iconPath = new this.code.ThemeIcon('warning', new this.code.ThemeColor('problemsWarningIcon.foreground'));
                item.tooltip = this.code.l10n.t('Admin user is enabled. This is a security risk and is not recommended for production registries.');
            }
        }

        return item;
    }

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

    public getParent(key: string): string | undefined {
        return AzureNodeId.parse(key).parentNodeId()?.toString();
    }

    // #endregion
}

const categoryLabels = new Set(['Repositories', 'Webhooks']);

/**
 * A category node is a virtual resource whose `virtualPath` is one of
 * the known category labels (e.g. "Repositories", "Webhooks").
 */
function isCategoryNode(resource: VirtualResource): boolean {
    return categoryLabels.has(resource.virtualPath);
}
