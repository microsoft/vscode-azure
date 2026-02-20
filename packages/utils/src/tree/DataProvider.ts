/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ProviderResult } from '../types/ProviderResult';

/**
 * Data-layer provider for the root of a resource tree.
 *
 * Produces the top-level resources that appear at the root of the tree.
 * There is typically one per tree view (e.g. one for Azure resources, one or
 * more for workspace resources).
 *
 * @typeParam TResource - The resource type produced by this provider.
 */
export interface RootDataProvider<TResource> {
    /**
     * Get the top-level resources for the tree.
     */
    getChildren(): ProviderResult<Readonly<TResource>[]>;
}

/**
 * Data-layer provider for a branch of a resource tree.
 *
 * Each implementation handles a specific subset of resources (identified by
 * {@link canHandle}) and knows how to fetch their children from the API.
 *
 * @typeParam TResource - The base resource type this provider operates on.
 *   Implementations may narrow this to a service-specific subtype.
 */
export interface BranchDataProvider<TResource> {
    /**
     * Test whether this provider handles the given resource.
     * Also acts as a type guard to narrow the resource to `TResource`.
     */
    canHandle(resource: Readonly<unknown>): resource is Readonly<TResource>;

    /**
     * Get child resources for the given parent.
     *
     * @returns An array of child resources. Return an empty array or undefined for leaf nodes.
     */
    getChildren(resource: Readonly<TResource>): ProviderResult<Readonly<TResource>[]>;
}
