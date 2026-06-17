/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription } from '../auth/AzureSubscription';
import { isSubscription, isTenant, type ConcreteAzureNodeTree } from '../models/AzureNode';

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

    const accounts = await tree.getChildren();
    for (const account of accounts) {
        let tenants = await tree.getChildren(account);
        if (targetTenant) {
            tenants = tenants.filter(node => isTenant(node) && node.tenantId.toLowerCase() === targetTenant);
        }

        for (const tenant of tenants) {
            const subscriptions = await tree.getChildren(tenant);
            const match = subscriptions.find(
                (node): node is AzureSubscription => isSubscription(node) && node.subscriptionId.toLowerCase() === target,
            );
            if (match) {
                return match;
            }
        }
    }

    return undefined;
}
