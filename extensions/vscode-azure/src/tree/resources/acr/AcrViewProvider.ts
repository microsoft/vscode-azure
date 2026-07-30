/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, getNodeType, isGenericResource, isVirtualResource, type VirtualResource } from '@microsoft/vscode-azure-azutils';
import type { ITreeItem, ViewProvider } from '@microsoft/vscode-azure-utils';
import { IActionExecutor, ICodeContext } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { DisableAcrAdminUser } from '../../../commands/acr/DisableAcrAdminUser';
import { OpenInPortal } from '../../../commands/tree/OpenInPortal';
import { IAzureViewDataTree } from '../../../services';
import { combineContextValues } from '../../combineContextValues';
import { getResourceTypeIconUri } from '../../iconPath';
import type { ResourceTypePresentation } from '../ResourceTypePresentation';
import { AcrResourceType, isAcrRegistry } from './AcrRegistry';

/**
 * View-layer provider for Azure Container Registries.
 *
 * Handles tree-item rendering for ACR registry nodes, customising the
 * icon, description, and context value so that ACR-specific commands can
 * be scoped via `when` clauses.
 *
 * Before enrichment completes the node is rendered with a generic label;
 * once {@linkcode AcrDataProvider.enrich} has run and the tree fires
 * `onDidChange`, this provider re-renders the item with the full details.
 */
@injectable()
export class AcrViewProvider implements ViewProvider<string> {
    /** Presentation metadata for Azure Container Registry resource-type groups. */
    public static readonly resourceTypePresentation: ResourceTypePresentation = {
        logicalType: AcrResourceType,
        getDisplayName: code => code.l10n.t('Container Registries'),
    };

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
        return !!node && (isAcrRegistry(node) || (isVirtualResource(node) && isAcrRegistry(node.azureResource)));
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

        // Virtual sub-nodes (categories and leaf items)
        if (isVirtualResource(resource) && resource.virtualType.startsWith('acr.')) {
            const label = resource.virtualPath;

            // Categories share their virtualType with their children,
            // but categories are the ones that match the category label
            const isCategory = isCategoryNode(resource);
            const collapsibleState = isCategory
                ? this.ctx.code.TreeItemCollapsibleState.Collapsed
                : this.ctx.code.TreeItemCollapsibleState.None;

            const item = new this.ctx.code.TreeItem(label, collapsibleState);
            item.id = key;
            item.contextValue = isCategory ? 'acrCategory' : 'acrItem';
            item.iconPath = isCategory
                ? new this.ctx.code.ThemeIcon('folder')
                : new this.ctx.code.ThemeIcon('symbol-misc');
            return item;
        }

        if (!isGenericResource(resource)) {
            throw new Error('Expected an Azure resource or virtual resource');
        }

        // Collapsed since we have children
        const item = new this.ctx.code.TreeItem(resource.name, this.ctx.code.TreeItemCollapsibleState.Collapsed);
        item.id = key;
        item.contextValue = combineContextValues(OpenInPortal.ContextValue, DisableAcrAdminUser.ContextValue);
        item.iconPath = getResourceTypeIconUri(this.ctx, resource.logicalType);

        if (isAcrRegistry(resource)) {
            item.description = resource.logicalType;

            if (resource.adminUserEnabled === true) {
                item.iconPath = new this.ctx.code.ThemeIcon('warning', new this.ctx.code.ThemeColor('problemsWarningIcon.foreground'));
                item.tooltip = this.ctx.code.l10n.t('Admin user is enabled. This is a security risk and is not recommended for production registries.');
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

        this.executor.setTelProp('nodeType', getNodeType(resource));

        const children = await this.cache.getChildren(resource);
        return children.map(child => AzureNodeId.from(child).toString());
    }

    /** @inheritdoc */
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
