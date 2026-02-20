/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import type { ProviderResult } from '../types/ProviderResult';
import type { BranchDataProvider, RootDataProvider } from './DataProvider';

/**
 * View-layer provider for the root of a resource tree.
 *
 * Converts the top-level resources (produced by a {@link RootDataProvider})
 * into VS Code tree items for rendering.
 *
 * View providers are allowed to inject extra virtual children under the
 * resources they own, change order, group, filter, etc. but may not modify the
 * underlying data layer resources.
 *
 * @typeParam TResource - The resource type this provider renders.
 */
export interface RootViewProvider<TResource> extends RootDataProvider<TResource> {
    /**
     * Get the tree item representation for a root resource.
     */
    getTreeItem(resource: Readonly<TResource>): ProviderResult<vscode.TreeItem>;
}

/**
 * View-layer provider for a branch of a resource tree.
 *
 * Each implementation handles a specific subset of resources (identified by
 * {@link canHandle}) and knows how to render them as VS Code tree items.
 *
 * View providers are allowed to inject extra virtual children under the
 * resources they own, change order, group, filter, etc. but may not modify the
 * underlying data layer resources.
 *
 * @typeParam TResource - The base resource type this provider operates on.
 *   Implementations may narrow this to a service-specific subtype.
 */
export interface BranchViewProvider<TResource> extends BranchDataProvider<TResource> {
    /**
     * Get the tree item representation for the given resource.
     */
    getTreeItem(resource: Readonly<TResource>): ProviderResult<vscode.TreeItem>;
}
