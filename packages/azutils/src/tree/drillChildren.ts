/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ConcreteAzureNode, ConcreteAzureNodeTree } from '../models/AzureNode';

/**
 * Lazily yield every child of `resource` across all pages.
 *
 * The account/tenant/subscription data providers return paged `AsyncIterable`s,
 * so `DataItemTree.getChildren()` only materializes the first page. This helper
 * walks remaining pages via `hasMore()` and `loadMore()`, pulling each page only
 * when the consumer asks for more.
 *
 * Root-level children (`resource === undefined`) are not paged.
 */
export async function* drillChildren(tree: ConcreteAzureNodeTree, resource?: ConcreteAzureNode): AsyncIterable<ConcreteAzureNode> {
    let children = await tree.getChildren(resource);
    let index = 0;

    for (;;) {
        for (; index < children.length; index++) {
            yield children[index];
        }

        if (resource === undefined || !tree.hasMore(resource)) {
            return;
        }

        await tree.loadMore(resource);
        children = await tree.getChildren(resource);
    }
}
