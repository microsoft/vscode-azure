/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PagedAsyncIterableIterator } from '@azure/core-paging';
import type { Page } from '@microsoft/vscode-azure-utils';

/**
 * Converts a `PagedAsyncIterableIterator<T>` from an Azure SDK into an
 * `AsyncIterable<Page<T>>`, using `.byPage()` for page-level iteration.
 *
 * {@linkcode Page.hasMore} is determined by the `continuationToken`
 * property that modular REST-style SDKs attach to the page array
 * (`ContinuablePage`).
 *
 * @param iterator - The Azure SDK paged iterator.
 */
export function toPages<T>(
    iterator: PagedAsyncIterableIterator<T, T[]>,
): AsyncIterable<Page<T>>;

/**
 * Converts a `PagedAsyncIterableIterator<T>` from an Azure SDK into an
 * `AsyncIterable<Page<U>>`, applying {@linkcode map} to every item.
 *
 * If {@linkcode getContinuationToken} is supplied, it is used to compute
 * {@linkcode Page.hasMore} -- this is needed for classic
 * `ServiceClient`-style SDKs (e.g. `@azure/arm-resources`) where the
 * continuation token is stored in a `WeakMap` accessed via the SDK's
 * exported `getContinuationToken` helper rather than on the page array
 * itself. Otherwise the modular `ContinuablePage` shape is assumed.
 *
 * @param iterator - The Azure SDK paged iterator.
 * @param map - Mapping function applied to each item in a page.
 * @param getContinuationToken - Optional classic-SDK continuation token
 *   helper.
 */
export function toPages<T, U>(
    iterator: PagedAsyncIterableIterator<T, T[]>,
    map: (item: T) => U,
    getContinuationToken?: (page: unknown) => string | undefined,
): AsyncIterable<Page<U>>;

export async function* toPages<T, U>(
    iterator: PagedAsyncIterableIterator<T, T[]>,
    map?: (item: T) => U,
    getContinuationToken?: (page: unknown) => string | undefined,
): AsyncIterable<Page<T | U>> {
    for await (const items of iterator.byPage()) {
        yield {
            items: map ? items.map(map) : items,
            hasMore: getContinuationToken
                ? !!getContinuationToken(items)
                : !!(items as unknown as { continuationToken?: string }).continuationToken,
        };
    }
}
