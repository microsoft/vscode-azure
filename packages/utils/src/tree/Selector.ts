/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The breadth of a match produced by a {@linkcode Selector}.
 *
 * - `'self'`    -- the matched node only. Its label is re-rendered but its
 *   cached children are preserved (no re-fetch). The traversal keeps
 *   descending, so descendants may still match independently.
 * - `'subtree'` -- the matched node *and* everything beneath it. The cached
 *   subtree is evicted and re-fetched on next access, and the traversal stops
 *   descending past the match (the apex absorbs its whole subtree).
 */
export type MatchScope = 'self' | 'subtree';

/**
 * A predicate that, given a single data-layer resource, returns a *verdict*
 * describing whether and how that resource should be acted on:
 *
 * - `'self'` / `'subtree'` -- the resource matches (see {@linkcode MatchScope}).
 * - `undefined` -- no match; keep looking.
 *
 * A selector is a pure verdict function -- it must **not** mutate the resource
 * or rely on tree structure. The tree is responsible for walking nodes and
 * applying the verdict. To target a whole subtree (e.g. "everything under
 * subscription X"), return `'subtree'` at the apex node only; the tree evicts
 * the descendants for you. Selectors run over **data-layer** resources only,
 * never view-layer virtual grouping nodes.
 *
 * Selectors should key on fields that are stable *before* enrichment (e.g. an
 * ARM `type` from the listing), because a node may be visited before its
 * background enrichment has populated derived fields.
 *
 * @typeParam T - The data item type stored in the tree.
 */
export type Selector<T> = (resource: T) => MatchScope | undefined;

/**
 * Sentinel target that triggers a reconciling re-list of the **root** level
 * without wiping the tree: the next root fetch re-lists the top level and
 * preserves the subtrees under roots that are still present, evicting only the
 * subtrees of roots that have disappeared. Use when the *set* of roots may have
 * changed (e.g. an account signed in / out) but the data under surviving roots
 * is still valid.
 *
 * This is a target, not a {@linkcode Selector}: a node predicate cannot express
 * "re-list the roots", because a newly-signed-in root is not yet loaded and so
 * cannot be visited.
 */
export const Roots: unique symbol = Symbol('DataItemTree.Roots');

/**
 * Sentinel target that wipes the **entire** cache (all nodes, roots, and
 * enrichment promises) and fires a full refresh. Use as the corruption escape
 * hatch and when a global precondition changed such that every cached listing
 * is invalid (e.g. the configured sovereign cloud / environment changed).
 *
 * This is a target, not a {@linkcode Selector}: it must also drop the cached
 * root listing itself, which a per-node predicate cannot reach.
 */
export const Everything: unique symbol = Symbol('DataItemTree.Everything');

const keyMatchBrand: unique symbol = Symbol('DataItemTree.KeyMatch');

/**
 * A by-key match descriptor produced by {@linkcode selfOnly} /
 * {@linkcode subtreeOf}. The tree resolves the `match` entries to keys using
 * its own `getKey` extractor, so a resource and its key are interchangeable.
 *
 * @typeParam T - The data item type stored in the tree.
 */
export interface KeyMatch<T> {
    readonly [keyMatchBrand]: true;
    readonly scope: MatchScope;
    /** Resources and/or keys to match by key equality. */
    readonly match: ReadonlyArray<T | string>;
}

/**
 * Build a {@linkcode KeyMatch} that targets exactly the given resources/keys
 * with `'self'` scope: each matched node's label is re-rendered but its cached
 * children are preserved. This is the shallow counterpart to passing a bare
 * resource (which is treated as `'subtree'`).
 *
 * @param match - One or more resources or keys to match by key equality.
 */
export function selfOnly<T>(...match: ReadonlyArray<T | string>): KeyMatch<T> {
    return { [keyMatchBrand]: true, scope: 'self', match };
}

/**
 * Build a {@linkcode KeyMatch} that targets the given resources/keys *and their
 * subtrees* (`'subtree'` scope): each matched node's cached subtree is evicted
 * and re-fetched on next access. This is the explicit, named form of passing a
 * bare resource as a target.
 *
 * @param match - One or more resources or keys to match by key equality.
 */
export function subtreeOf<T>(...match: ReadonlyArray<T | string>): KeyMatch<T> {
    return { [keyMatchBrand]: true, scope: 'subtree', match };
}

/**
 * Type guard for {@linkcode KeyMatch} descriptors.
 */
export function isKeyMatch<T>(value: unknown): value is KeyMatch<T> {
    return typeof value === 'object' && value !== null && keyMatchBrand in value;
}

/**
 * The set of inputs accepted by `DataItemTree.invalidate` / `.remove`.
 *
 * Disambiguated at runtime by `typeof` / shape:
 * - a {@linkcode Roots} / {@linkcode Everything} symbol (sentinel),
 * - a function -- a {@linkcode Selector},
 * - a {@linkcode KeyMatch} descriptor ({@linkcode selfOnly} / {@linkcode subtreeOf}),
 * - a `string` -- a resource key, treated as `'subtree'`,
 * - a `T` (resource object) -- matched by key, treated as `'subtree'`,
 * - an array of resources/keys -- key-membership, treated as `'subtree'`.
 *
 * **Precondition:** `T` is neither `string` nor a function (holds for the
 * extension's node types). The bare-resource shorthand is deliberately
 * `'subtree'` while {@linkcode selfOnly} is `'self'` -- the raw resource is the
 * ergonomic "deep" form matching the historical default.
 *
 * @typeParam T - The data item type stored in the tree.
 */
export type Target<T> =
    | Selector<T>
    | KeyMatch<T>
    | T
    | string
    | ReadonlyArray<T | string>
    | typeof Roots
    | typeof Everything;
