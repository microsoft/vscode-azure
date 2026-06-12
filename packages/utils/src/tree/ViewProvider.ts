/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ITreeItem } from '../vscode/IVsCode';
import type { ProviderResult } from '../vscode/ProviderResult';
import type { DataProvider } from './DataProvider';

/**
 * View-layer provider for a resource tree.
 *
 * Each implementation handles a specific subset of resources (identified by
 * {@linkcode canHandle}) and knows how to render them as VS Code tree items.
 *
 * View providers are allowed to inject extra virtual children under the
 * resources they own, change order, group, filter, etc. but may not modify the
 * underlying data layer resources in any way.
 *
 * View providers always return plain arrays from {@linkcode getChildren}
 * (never paginated `AsyncIterable`s). Pagination is a data-layer concern.
 *
 * @typeParam TResource - The base resource type this provider operates on.
 *   Implementations may narrow this to a service-specific subtype.
 */
export interface ViewProvider<TResource> extends Omit<DataProvider<TResource>, 'enrich' | 'getTtl'> {
    /**
     * Get children for the given resource. View providers always return
     * plain arrays (pagination is handled by the data layer).
     */
    getChildren(resource?: TResource): ProviderResult<TResource[]>;

    /**
     * Get the tree item representation for the given resource.
     */
    getTreeItem(resource: Readonly<TResource>): ITreeItem | Promise<ITreeItem>;

    /**
     * Get the parent of a resource, or `undefined` if it is a root item.
     *
     * Implementing this method enables `TreeView.reveal()` for nodes that
     * have not yet been loaded via {@linkcode getChildren}. The tree will
     * call this to walk up to the root, then walk back down via
     * {@linkcode getChildren} to load real data at each level.
     */
    getParent?(resource: Readonly<TResource>): ProviderResult<TResource | undefined>;
}
