/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { flattenPages, isAsyncIterable, type Page } from '../../src/data/Page';
import type { ChildResult } from '../../src/tree/DataProvider';

/**
 * Drains an {@linkcode AsyncIterable} into an array, preserving order.
 *
 * A tiny test convenience for the common "iterate a paged/streamed source to
 * completion, then assert on the collected result" pattern. Do not use it on
 * an unbounded iterable -- it only resolves once the iterable is exhausted.
 *
 * @param iterable The source to drain fully.
 * @returns Every yielded element, in the order produced.
 */
export async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
    const collected: T[] = [];
    for await (const item of iterable) {
        collected.push(item);
    }
    return collected;
}

/**
 * Collects every {@linkcode Page} from a {@linkcode ChildResult} produced by a
 * {@linkcode DataProvider.getChildren} call, so tests can assert on page
 * boundaries (item batches and `hasMore` flags) without hand-rolling the drain
 * loop.
 *
 * Handles both shapes of {@linkcode ChildResult}: a paged
 * `AsyncIterable<Page<T>>` is drained via {@linkcode collectAsync}, while a
 * synchronous resource array is treated as a single complete page. A
 * `null`/`undefined` result (e.g. a provider that returned no children) yields
 * an empty array.
 *
 * @param result The value returned from a provider's `getChildren`.
 * @returns The pages in order, or `[]` when there were none.
 */
export async function collectPages<T>(result: ChildResult<T> | null | undefined): Promise<Page<T>[]> {
    if (!result) {
        return [];
    }
    if (isAsyncIterable(result)) {
        return collectAsync(result);
    }
    // A synchronous array of resources is a single, complete page.
    return [{ items: result, hasMore: false }];
}

/**
 * Drains an `AsyncIterable<Page<T>>` and flattens it into a single ordered
 * array of items, discarding page boundaries.
 *
 * The item-level counterpart to {@linkcode collectPages}: use this when a test
 * only cares about the aggregate items (not how they were paged), replacing the
 * common `for await (const page of ...) items.push(...page.items)` loop.
 *
 * @param pages The paged source to drain fully.
 * @returns Every item across all pages, in order.
 */
export async function collectPageItems<T>(pages: AsyncIterable<Page<T>>): Promise<T[]> {
    return collectAsync(flattenPages(pages));
}
