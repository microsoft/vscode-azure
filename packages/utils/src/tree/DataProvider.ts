/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Page } from '../data/Page';
import type { Event } from '../vscode/EventEmitter';
import type { ProviderResult } from '../vscode/ProviderResult';

/**
 * Event fired by a {@linkcode DataProvider} when its data changes externally
 * (e.g. polling, user action). The tree subscribes to this automatically
 * when the provider is registered.
 */
export interface DataProviderChangeEvent<TResource> {
    /** The resource that changed, or `undefined` for root-level changes. */
    readonly resource?: TResource;
    /** When `true`, cached children are invalidated and re-fetched. */
    readonly includeChildren: boolean;
    /**
     * Tags identifying which cached nodes to invalidate, as produced by
     * {@linkcode DataProvider.getTags} (or auto-derived `ancestor:<key>` tags).
     *
     * When present and non-empty, the tree dispatches each tag to
     * {@linkcode DataItemTree.invalidateByTag} and ignores {@linkcode resource}
     * / {@linkcode includeChildren}. This lets a provider invalidate a logical
     * slice of the tree (e.g. every node pertaining to one account) without
     * knowing where those nodes currently live in the tree. When omitted, the
     * tree falls back to the {@linkcode resource} / {@linkcode includeChildren}
     * behavior; a root-level change (`resource` undefined) with
     * `includeChildren: false` triggers a reconciling root re-list via
     * {@linkcode DataItemTree.invalidateRoot}.
     */
    readonly tags?: string[];
}

/**
 * The result of a {@linkcode DataProvider.getChildren} call.
 *
 * - A plain `TResource[]` for non-paginated results.
 * - An `AsyncIterable<Page<TResource>>` whose iterations each yield one page
 *   of children. Each page declares whether more pages are available via
 *   {@linkcode Page.hasMore}. The tree pulls the first page on initial access
 *   and subsequent pages on demand ("Load More").
 */
export type ChildResult<TResource> = TResource[] | AsyncIterable<Page<TResource>>;

/**
 * Data-layer provider for a resource tree.
 *
 * Each implementation handles a specific subset of resources (identified by
 * {@linkcode canHandle}) and knows how to fetch their children from the API.
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
     * generator) where each iteration yields a single {@linkcode Page}. The
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
     * Optionally override the cache time-to-live (TTL), in milliseconds, for the
     * children of the given resource.
     *
     * Called by {@linkcode DataItemTree} after children are fetched to decide
     * when they become stale. When omitted, the tree's default TTL is used.
     * Return `Infinity` to mark children as never-expiring (invalidated only by
     * explicit {@linkcode DataItemTree.invalidate} / {@linkcode DataItemTree.invalidateAll}
     * calls or {@linkcode onDidChange} events).
     *
     * @param resource - The parent resource whose children were fetched, or
     *   `undefined` for the root (root providers only).
     */
    getTtl?(resource?: TResource): number;

    /**
     * Optionally return the semantic tags that identify the given resource's
     * own cache node (e.g. `account:<id>`, `tenant:<id>`, `type:<armType>`,
     * `resourceId:<id>`).
     *
     * Tags label the node *itself*, not its children listing. The tree calls
     * this on the provider that *produced* the resource (the provider that
     * handles its parent, or the root provider for root resources) and records
     * the returned tags in a reverse index (tag -> node keys). In addition, the
     * tree auto-derives a structural `ancestor:<key>` tag for every ancestor of
     * the node, so a whole subtree can be addressed without walking child
     * links.
     *
     * A later {@linkcode DataItemTree.invalidateByTag} call hard-evicts every
     * node carrying the tag *plus* everything beneath them (discovered via the
     * `ancestor:<key>` tags), regardless of position in the tree, and fires a
     * single coalesced change event. This lets a caller invalidate broadly
     * ("everything pertaining to `account:foo`") or narrowly ("everything under
     * one subscription") purely by choosing which tag to name.
     *
     * When this method is absent (or returns an empty array) the node carries
     * only its auto-derived structural tags, which is fully back-compatible:
     * such nodes are still invalidated positionally via
     * {@linkcode DataItemTree.invalidate} / {@linkcode DataItemTree.invalidateAll}.
     *
     * @param resource - The resource whose identity tags are requested, or
     *   `undefined` for the root listing (root providers only; typically
     *   returns no tags since the root has no resource of its own).
     * @returns The semantic tags identifying `resource`.
     */
    getTags?(resource?: TResource): string[];

    /**
     * Optional event fired when the provider's data changes externally.
     * The tree automatically subscribes when the provider is registered
     * and calls {@linkcode DataItemTree.invalidate} or {@linkcode DataItemTree.invalidateAll}
     * accordingly.
     *
     * This is appropriate when the provider is aware of changes to its data that the
     * tree is not (e.g. polling, user action in another view, etc.). When practical,
     * {@linkcode DataItemTree.invalidate} should be used instead.
     */
    readonly onDidChange?: Event<DataProviderChangeEvent<TResource>>;
}
