/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A single page of items from a paginated result.
 */
export interface Page<T> {
    readonly items: T[];
    readonly hasMore: boolean;
}

/**
 * Type guard: returns `true` when `value` is an `AsyncIterable` (has
 * `Symbol.asyncIterator`), indicating paged results.
 */
export function isAsyncIterable<T>(value: T[] | AsyncIterable<Page<T>>): value is AsyncIterable<Page<T>> {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return !!value && typeof value === 'object'
        && Symbol.asyncIterator in value;
}

/**
 * Flattens an `AsyncIterable<Page<T>>` into an `AsyncIterable<T>` by
 * yielding each item from every page in order.
 */
export async function* flattenPages<T>(pages: AsyncIterable<Page<T>>): AsyncIterable<T> {
    for await (const page of pages) {
        yield* page.items;
    }
}

/**
 * Drops the items a predicate rejects, preserving page boundaries and each
 * page's `hasMore` flag so the reader's paging is unaffected by how many items a
 * page lost. A page that loses every item is still yielded, because its
 * `hasMore` is what tells the reader whether to keep going.
 *
 * Passing no predicate yields the pages unchanged, so "nothing is filtered" and
 * "everything is admitted" are spelled the same way at a call site.
 */
export async function* filterPages<T>(pages: AsyncIterable<Page<T>>, predicate?: (item: T) => boolean): AsyncIterable<Page<T>> {
    for await (const page of pages) {
        yield predicate ? { items: page.items.filter(predicate), hasMore: page.hasMore } : page;
    }
}
