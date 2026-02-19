/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CacheKey } from '@microsoft/vscode-azure-utils';

/**
 * Per-resource-type adapter that knows how to fetch resources from the API.
 * One implementation per resource type (resource groups, generic resources, etc.).
 *
 * @typeParam TResource - The resource shape returned by the fetcher.
 * @typeParam TScopeKey - The key type for list operations (e.g. subscription-scoped).
 * @typeParam TItemKey - The key type for identifying a single resource.
 */
export interface ResourceFetcher<TResource, TScopeKey extends CacheKey, TItemKey> {
    /** Fetch all resources for the given scope from the API. */
    fetchList(scope: TScopeKey): Promise<TResource[]>;

    /** Fetch a single resource by key from the API. */
    fetchItem(key: TItemKey): Promise<TResource>;

    /** Test whether a resource matches the given item key. Used by `getByList()`. */
    itemKeyEquals(resource: TResource, key: TItemKey): boolean;
}
