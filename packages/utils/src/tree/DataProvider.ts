/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Page } from '../data/Page';
import type { Event } from '../vscode/EventEmitter';
import type { ProviderResult } from '../vscode/ProviderResult';

/**
 * Event fired by a {@link DataProvider} when its data changes externally
 * (e.g. polling, user action). The tree subscribes to this automatically
 * when the provider is registered.
 */
export interface DataProviderChangeEvent<TResource> {
    /** The resource that changed, or `undefined` for root-level changes. */
    readonly resource?: TResource;
    /** When `true`, cached children are invalidated and re-fetched. */
    readonly includeChildren: boolean;
}

/**
 * The result of a {@link DataProvider.getChildren} call.
 *
 * - A plain `TResource[]` for non-paginated results.
 * - An `AsyncIterable<Page<TResource>>` whose iterations each yield one page
 *   of children. Each page declares whether more pages are available via
 *   {@link Page.hasMore}. The tree pulls the first page on initial access
 *   and subsequent pages on demand ("Load More").
 */
export type ChildResult<TResource> = TResource[] | AsyncIterable<Page<TResource>>;

/**
 * Data-layer provider for a resource tree.
 *
 * Each implementation handles a specific subset of resources (identified by
 * {@link canHandle}) and knows how to fetch their children from the API.
 *
 * A provider with an `isRoot: true` property will also be called with no
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
    canHandle(resource: unknown): resource is TResource;

    /**
     * Get child resources for the given parent, or the top-level resources
     * when called with no argument (root providers only).
     *
     * Return a plain `TResource[]` for a non-paginated result, or an
     * `AsyncIterable<Page<TResource>>` (e.g. from an `async function*`
     * generator) where each iteration yields a single {@link Page}. The
     * tree will pull one page on first access and subsequent pages when
     * the user clicks "Load More".
     *
     * @returns Child resources or `undefined` / empty for leaf nodes.
     */
    getChildren(resource?: TResource): ProviderResult<ChildResult<TResource>>;

    /**
     * Enrich a resource in-place with provider-specific data.
     *
     * Called automatically by the tree when the resource itself is loaded,
     * for each resource that this provider {@link canHandle handles}. The
     * implementation should mutate the resource object directly so the
     * tree's reference remains stable. Key properties such as `id`, `type`,
     * etc. should not be changed, but additional fields may be added as needed.
     *
     * @returns `true` if the enrichment also changed the resource's children
     *   (e.g. populated a field that child providers depend on), causing
     *   cached children to be removed and re-fetched on next access.
     *   Returning `false` only re-renders the resource's own tree item;
     *   children will still be re-rendered, but the next access will hit
     *   the cache, avoiding a re-fetch (unless they are stale).
     */
    enrich?(resource: TResource): boolean | Promise<boolean>;

    /**
     * Whether a provider can return root-level resources (i.e. be called with `undefined`).
     */
    readonly isRoot?: boolean;

    /**
     * Optional event fired when the provider's data changes externally.
     * The tree automatically subscribes when the provider is registered
     * and calls {@link DataItemTree.invalidate} or {@link DataItemTree.invalidateAll}
     * accordingly.
     *
     * This is appropriate when the provider is aware of changes to its data that the
     * tree is not (e.g. polling, user action in another view, etc.). When practical,
     * {@link DataItemTree.invalidate} should be used instead.
     */
    readonly onDidChange?: Event<DataProviderChangeEvent<TResource>>;
}
