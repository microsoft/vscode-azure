/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ProviderResult } from '../types/ProviderResult';

/**
 * Data-layer provider for a resource tree.
 *
 * Each implementation handles a specific subset of resources (identified by
 * {@link canHandle}) and knows how to fetch their children from the API.
 *
 * A provider registered with `{ root: true }` will also be called with no
 * argument to produce top-level resources for the tree.
 *
 * @typeParam TResource - The base resource type this provider operates on.
 *   Implementations may narrow this to a service-specific subtype.
 */
export interface DataProvider<TResource> {
    /**
     * Test whether this provider handles the given resource.
     * Also acts as a type guard to narrow the resource to `TResource`.
     */
    canHandle(resource: Readonly<unknown>): resource is Readonly<TResource>;

    /**
     * Get child resources for the given parent, or the top-level resources
     * when called with no argument (root providers only).
     *
     * @returns An array of child resources. Return an empty array or undefined for leaf nodes.
     */
    getChildren(resource?: Readonly<TResource>): ProviderResult<Readonly<TResource>[]>;

    /**
     * Enrich a resource in-place with provider-specific data.
     *
     * Called automatically by the tree when the resource itself is loaded,
     * for each resource that this provider {@link canHandle handles}. The
     * implementation should mutate the resource object directly so the
     * tree's reference remains stable. Key properties such as `id`, `type`,
     * etc. should not be changed, but additional fields may be added as needed.
     */
    enrich?(resource: TResource): Promise<void> | void;
}
