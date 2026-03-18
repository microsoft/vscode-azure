/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PagedAsyncIterableIterator } from '@azure/core-paging';
import type { Page } from '@microsoft/vscode-azure-utils';

/**
 * Converts a `PagedAsyncIterableIterator<T>` from an Azure SDK into an
 * `AsyncIterable<Page<U>>`, using `.byPage()` for page-level iteration
 * and `getContinuationToken` to set {@link Page.hasMore}.
 *
 * @param iterator - The Azure SDK paged iterator.
 * @param getContinuationToken - The SDK's `getContinuationToken` function
 *   (re-exported from each ARM package).
 * @param map - Optional mapping function applied to each item in a page.
 *   When omitted, items are yielded as-is (and `T` must equal `U`).
 */
export async function* toPages<T, U = T>(
    iterator: PagedAsyncIterableIterator<T, T[]>,
    getContinuationToken: (page: unknown) => string | undefined,
    map?: (item: T) => U,
): AsyncIterable<Page<U>> {
    for await (const items of iterator.byPage()) {
        yield {
            items: map ? items.map(map) : items as unknown as U[],
            hasMore: !!getContinuationToken(items),
        };
    }
}
