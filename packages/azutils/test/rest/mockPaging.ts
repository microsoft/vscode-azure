/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PagedAsyncIterableIterator } from '@azure/core-paging';

/**
 * Wraps fixed pages of items in the {@linkcode PagedAsyncIterableIterator}
 * shape an Azure SDK returns, for stubbing a `list*` operation.
 *
 * Both iteration surfaces are populated: the default one walks items across
 * page boundaries, and `byPage()` yields each page's array. Every page but the
 * last carries a `continuationToken`, which is how the SDKs signal more results
 * and how {@linkcode toPages} derives `hasMore`.
 *
 * Use this for a client that hands back the raw SDK pager. A producer that
 * already returns the project-standard `AsyncIterable<Page<T>>` -- most wrapped
 * clients -- should use `pagesOf` from `@microsoft/vscode-azure-utils/testing`
 * instead.
 *
 * @example
 * ```typescript
 * listRevisions: mock.fn(() => makePagedAsyncIterable([revisionA, revisionB]))
 * ```
 */
export function makePagedAsyncIterable<T>(...pages: readonly (readonly T[])[]): PagedAsyncIterableIterator<T, T[]> {
    const items = pages.flat();
    let itemIndex = 0;

    const pager: PagedAsyncIterableIterator<T, T[]> = {
        [Symbol.asyncIterator]: () => pager,
        next: () => Promise.resolve(itemIndex < items.length
            ? { done: false as const, value: items[itemIndex++] }
            : { done: true as const, value: undefined as unknown as T }),
        byPage: () => {
            let index = 0;
            const pageIterator = {
                next() {
                    if (index >= pages.length) {
                        return Promise.resolve({ done: true as const, value: undefined as unknown as T[] });
                    }

                    // A real pager marks every page but the last with a token,
                    // so a consumer can tell "more to come" from "that was all".
                    const page = [...pages[index]];
                    if (index < pages.length - 1) {
                        Object.assign(page, { continuationToken: `page-${index + 1}` });
                    }
                    index++;
                    return Promise.resolve({ done: false as const, value: page });
                },
                [Symbol.asyncIterator]() {
                    return pageIterator;
                },
            };
            return pageIterator;
        },
    };

    return pager;
}
