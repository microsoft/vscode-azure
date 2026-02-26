/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, isGenericResource } from '@microsoft/vscode-azure-azutils';
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
        return !!node && isAcrRegistry(node);
    }

    public getTreeItem(key: string): vscode.TreeItem {
        const resource = this.cache.get(key);
        if (!resource || !isGenericResource(resource)) {
            return new vscode.TreeItem(key);
        }

        // Leaf for now; will be Collapsed once repos/tags are available
        const item = new vscode.TreeItem(resource.name, vscode.TreeItemCollapsibleState.None);
        item.id = key;
        item.contextValue = 'azureContainerRegistry';
        item.iconPath = new vscode.ThemeIcon('package');

        if (isAcrRegistry(resource)) {
            item.description = resource.loginServer;
        }

        return item;
    }

    /**
     * No children yet — will return repository nodes once the data-plane
     * integration is in place.
     */
    public getChildren(_key?: string): string[] {
        return [];
    }

    // #endregion
}
