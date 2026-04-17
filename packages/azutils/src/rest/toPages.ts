/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PagedAsyncIterableIterator } from '@azure/core-paging';
import type { IOutputChannel, Page } from '@microsoft/vscode-azure-utils';

/**
 * Converts a `PagedAsyncIterableIterator<T>` from an Azure SDK into an
 * `AsyncIterable<Page<T>>`, using `.byPage()` for page-level iteration
 * and `getContinuationToken` to set {@linkcode Page.hasMore}.
 *
 * @param iterator - The Azure SDK paged iterator.
 * @param getContinuationToken - The SDK's `getContinuationToken` function
 *   (re-exported from each ARM package).
 */
export function toPages<T>(
    iterator: PagedAsyncIterableIterator<T, T[]>,
    getContinuationToken: (page: unknown) => string | undefined,
    output?: IOutputChannel,
): AsyncIterable<Page<T>>;

/**
 * Converts a `PagedAsyncIterableIterator<T>` from an Azure SDK into an
 * `AsyncIterable<Page<U>>`, using `.byPage()` for page-level iteration
 * and `getContinuationToken` to set {@linkcode Page.hasMore}.
 *
 * @param iterator - The Azure SDK paged iterator.
 * @param getContinuationToken - The SDK's `getContinuationToken` function
 *   (re-exported from each ARM package).
 * @param map - Mapping function applied to each item in a page.
 */
export function toPages<T, U>(
    iterator: PagedAsyncIterableIterator<T, T[]>,
    getContinuationToken: (page: unknown) => string | undefined,
    map: (item: T) => U,
    output?: IOutputChannel,
): AsyncIterable<Page<U>>;

export async function* toPages<T, U>(
    iterator: PagedAsyncIterableIterator<T, T[]>,
    getContinuationToken: (page: unknown) => string | undefined,
    mapOrOutput?: ((item: T) => U) | IOutputChannel,
    outputOrUndefined?: IOutputChannel,
): AsyncIterable<Page<T | U>> {
    const map = typeof mapOrOutput === 'function' ? mapOrOutput : undefined;
    const output = typeof mapOrOutput === 'function' ? outputOrUndefined : mapOrOutput;
    let pageIndex = 0;
    for await (const items of iterator.byPage()) {
        const continuationToken = getContinuationToken(items);
        output?.trace('[rest] page index=%d count=%d hasContinuation=%o', pageIndex, items.length, !!continuationToken);
        yield {
            items: map ? items.map(map) : items,
            hasMore: !!continuationToken,
        };
        pageIndex++;
    }
}
