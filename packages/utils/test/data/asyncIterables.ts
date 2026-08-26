/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Page } from '../../src/data/Page';

/**
 * Wraps a fixed sequence in an {@linkcode AsyncIterable}, for a test that needs
 * one as a fixture rather than as the subject of the test.
 *
 * Each call to {@linkcode Symbol.asyncIterator} walks `values` from the start,
 * so the result can be iterated more than once as long as `values` itself can
 * be.
 *
 * This is the produce-side counterpart to the `collectAsync` drain helper.
 */
export function asAsyncIterable<T>(values: Iterable<T>): AsyncIterable<T> {
    return {
        [Symbol.asyncIterator]() {
            const iterator = values[Symbol.iterator]();
            return { next: () => Promise.resolve(iterator.next()) };
        },
    };
}

/**
 * Builds the `AsyncIterable<Page<T>>` that paged producers return, from one
 * array of items per page.
 *
 * Every page but the last reports `hasMore: true`, which is the shape a real
 * pager produces, so a consumer that stops early or drains to the end behaves
 * as it would against a live service. Pass no pages for an empty result, or a
 * single empty array for one empty page -- consumers distinguish these.
 *
 * @example
 * ```typescript
 * const children = pagesOf([{ id: 'a' }, { id: 'b' }], [{ id: 'c' }]);
 * // page 0: { items: [a, b], hasMore: true }
 * // page 1: { items: [c], hasMore: false }
 * ```
 */
export function pagesOf<T>(...pages: readonly (readonly T[])[]): AsyncIterable<Page<T>> {
    return asAsyncIterable(pages.map((items, index) => ({
        items: [...items],
        hasMore: index < pages.length - 1,
    })));
}

/**
 * An {@linkcode AsyncIterable} whose first read rejects, for exercising the
 * failure path of a consumer that drains one.
 *
 * The rejection happens on `next()` rather than at construction, so the
 * consumer fails where it would against a service that refuses the request
 * mid-iteration rather than when the iterable is handed to it.
 */
export function rejectingAsyncIterable<T>(error: Error): AsyncIterable<T> {
    return {
        [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(error) }),
    };
}
