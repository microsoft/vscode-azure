/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription } from '../auth/AzureSubscription';
import { isSubscription, isTenant, type ConcreteAzureNode, type ConcreteAzureNodeTree } from '../models/AzureNode';

/**
 * Lazily yield every child of {@linkcode resource} across all pages.
 *
 * The account/tenant/subscription data providers return paged
 * `AsyncIterable`s, so {@linkcode ConcreteAzureNodeTree.getChildren} only
 * materializes the first page. This walks the remaining pages via
 * {@linkcode ConcreteAzureNodeTree.hasMore hasMore} /
 * {@linkcode ConcreteAzureNodeTree.loadMore loadMore}, pulling each subsequent
 * page only when the consumer asks for more -- so a caller that stops early
 * (e.g. after finding a match) never forces the later pages to load.
 *
 * Root-level children (`resource === undefined`) are not paged, so only the
 * single root page is yielded.
 */
async function* drillChildren(tree: ConcreteAzureNodeTree, resource?: ConcreteAzureNode): AsyncIterable<ConcreteAzureNode> {
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

/**
 * Resolve a fully-populated {@linkcode AzureSubscription} from a bare
 * subscription id by drilling the data tree (account -> tenant -> subscription).
 *
 * Unlike {@linkcode ConcreteAzureNodeTree.get DataItemTree.get}, this does not
 * require the caller to know the node's hierarchical key and it force-loads each
 * level via {@linkcode ConcreteAzureNodeTree.getChildren DataItemTree.getChildren},
 * so it resolves subscriptions even when the tree has never been expanded in the
 * UI. Loaded levels are cached by the tree, so repeated lookups within a single
 * operation are cheap.
 *
 * Tenants and subscriptions are paged, so the drill walks every page (lazily,
 * stopping as soon as a match is found) rather than only inspecting the first
 * page.
 *
 * When the owning `tenantId` is known, pass it to narrow the drill to that one
 * tenant, so subscriptions for the other tenants are never loaded.
 *
 * The drill short-circuits as soon as a match is found; comparison is
 * case-insensitive. Returns `undefined` when no signed-in account exposes a
 * subscription with the given id.
 *
 * @param tree - The Azure data-layer tree to drill.
 * @param subscriptionId - The subscription id to resolve (e.g. parsed from an
 *   ARM resource id).
 * @param tenantId - (Optional) The owning tenant id. When provided, only that
 *   tenant's subscriptions are searched.
 */
export async function findSubscriptionById(
    tree: ConcreteAzureNodeTree,
    subscriptionId: string,
    tenantId?: string,
): Promise<AzureSubscription | undefined> {
    const target = subscriptionId.toLowerCase();
    const targetTenant = tenantId?.toLowerCase();

    for await (const account of drillChildren(tree)) {
        for await (const tenant of drillChildren(tree, account)) {
            if (!isTenant(tenant)) {
                continue;
            }
            if (targetTenant && tenant.tenantId.toLowerCase() !== targetTenant) {
                continue;
            }

            for await (const node of drillChildren(tree, tenant)) {
                if (isSubscription(node) && node.subscriptionId.toLowerCase() === target) {
                    return node;
                }
            }
        }
    }

    return undefined;
}
