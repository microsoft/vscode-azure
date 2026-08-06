/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ChildResult } from '../tree/DataProvider';
import { flattenPages, isAsyncIterable, type Page } from './Page';

/**
 * Drains an {@linkcode AsyncIterable} into an array, preserving order.
 *
 * Do not use it on an unbounded iterable -- it only resolves once the iterable
 * is exhausted.
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
 * {@linkcode DataProvider.getChildren} call.
 *
 * Handles both shapes of {@linkcode ChildResult}: a paged
 * `AsyncIterable<Page<T>>` is drained via {@linkcode collectAsync}, while a
 * synchronous resource array is treated as a single complete page. A
 * `null`/`undefined` result yields an empty array.
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
    return [{ items: result, hasMore: false }];
}

/**
 * Drains an `AsyncIterable<Page<T>>` and flattens it into a single ordered
 * array of items, discarding page boundaries.
 *
 * @param pages The paged source to drain fully.
 * @returns Every item across all pages, in order.
 */
export async function collectPageItems<T>(pages: AsyncIterable<Page<T>>): Promise<T[]> {
    return collectAsync(flattenPages(pages));
}
