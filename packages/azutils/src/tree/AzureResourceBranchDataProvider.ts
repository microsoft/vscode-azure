/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DataProvider } from '@microsoft/vscode-azure-utils';
import type { GenericResource } from '../models/GenericResource';

/**
 * Azure-specific extension of {@link DataProvider} for resources in the
 * Azure resource tree.
 *
 * Adds:
 * - {@link enrich} - mutates a generic resource in-place with service-specific data.
 */
export interface AzureResourceBranchDataProvider extends DataProvider<GenericResource> {
    /**
     * Enrich a generic resource in-place with service-specific data.
     *
     * Called after the generic list has loaded the resource. The implementation
     * should mutate the resource object directly (e.g. via `Object.assign`)
     * so the tree's reference remains stable.
     *
     * Things like `id`, `name`, `type`, etc. should not be changed, but
     * the provider may add additional information or enrich existing properties
     */
    enrich?(resource: GenericResource): Promise<void> | void;
}
