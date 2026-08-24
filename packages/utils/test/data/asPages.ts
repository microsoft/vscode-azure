/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Page } from '../../src/data/Page';

/**
 * Wraps items in the paged async-iterable shape that list-style APIs return.
 *
 * The inverse of {@linkcode collectPageItems}, for arranging a mock client or provider. Each
 * argument becomes one page, so pass a single array for the common single-page case and several
 * to exercise a consumer's paging. The result is a fresh iterable on every call, so a mock built
 * from it can be listed more than once.
 */
export function asPages<T>(...pages: T[][]): AsyncIterable<Page<T>> {
    return {
        // eslint-disable-next-line @typescript-eslint/require-await -- pages are already in memory; nothing to await
        async *[Symbol.asyncIterator]() {
            for (let index = 0; index < pages.length; index++) {
                yield { items: pages[index], hasMore: index < pages.length - 1 };
            }
        },
    };
}
