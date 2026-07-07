/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DataItemTree } from './DataItemTree';
import type { FetchOptions } from './DataProvider';

/**
 * Lazily yield every child of `resource` across all pages.
 *
 * {@linkcode DataItemTree.getChildren} only materializes the first page of a
 * paged provider, so this helper walks the remaining pages via
 * {@linkcode DataItemTree.hasMore} and {@linkcode DataItemTree.loadMore},
 * pulling each page only when the consumer asks for more.
 *
 * Root-level children (`resource === undefined`) are not paged, so only their
 * single page is yielded.
 *
 * @param tree - The data-layer tree to drill.
 * @param resource - The node whose children to yield, or `undefined` for roots.
 * @param options - Optional {@linkcode FetchOptions} forwarded to the initial
 *   {@linkcode DataItemTree.getChildren} call (i.e. the first-page fetch). It
 *   is not re-applied to subsequent "Load More" pages, which continue the
 *   iterator established by that first fetch.
 */
export async function* drillChildren<T>(tree: DataItemTree<T>, resource?: T, options?: FetchOptions): AsyncIterable<T> {
    const firstPage = await tree.getChildren(resource, options);
    yield* firstPage;

    // Roots are not paged, so there is nothing more to drain. This also narrows
    // `resource` to `T` for the paged `hasMore`/`loadMore` calls below.
    if (resource === undefined) {
        return;
    }

    // `loadMore` appends to the cache and `getChildren` returns the full list, so
    // track how many items have already been yielded and emit only the new tail.
    let yielded = firstPage.length;
    while (tree.hasMore(resource)) {
        await tree.loadMore(resource);
        const children = await tree.getChildren(resource);
        for (; yielded < children.length; yielded++) {
            yield children[yielded];
        }
    }
}
