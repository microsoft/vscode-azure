/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import type { ProviderResult } from '../vscode/ProviderResult';
import type { DataProvider } from './DataProvider';

/**
 * View-layer provider for a resource tree.
 *
 * Each implementation handles a specific subset of resources (identified by
 * {@link canHandle}) and knows how to render them as VS Code tree items.
 *
 * View providers are allowed to inject extra virtual children under the
 * resources they own, change order, group, filter, etc. but may not modify the
 * underlying data layer resources in any way.
 *
 * @typeParam TResource - The base resource type this provider operates on.
 *   Implementations may narrow this to a service-specific subtype.
 */
export interface ViewProvider<TResource> extends DataProvider<TResource> {
    /**
     * Get the tree item representation for the given resource.
     */
    getTreeItem(resource: Readonly<TResource>): ProviderResult<vscode.TreeItem>;

    enrich?: never; // View providers are not allowed to enrich data resources
}
