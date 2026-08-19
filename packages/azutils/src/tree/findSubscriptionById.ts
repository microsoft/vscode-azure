/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { drillChildren, stringifyError, type IOutputChannel } from '@microsoft/vscode-azure-utils';
import type { AzureSubscription } from '../auth/AzureSubscription';
import { isAccount, isSubscription, isTenant, type ConcreteAzureNodeTree } from '../models/AzureNode';

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
 * tenant, so subscriptions for the other tenants are never loaded. Likewise,
 * when the owning `accountId` is known, pass it to narrow the drill to that one
 * account, so tenants (and their subscriptions) for the other accounts are
 * never loaded.
 *
 * The drill short-circuits as soon as a match is found; comparison is
 * case-insensitive. Returns `undefined` when no signed-in account exposes a
 * subscription with the given id.
 *
 * A tenant whose subscriptions cannot be listed -- typically because a
 * conditional access policy blocks token issuance for it -- is skipped rather
 * than aborting the search, so an unreachable tenant encountered along the way
 * never hides a subscription that lives in a later tenant.
 *
 * Callers that must not surface an interactive sign-in prompt (this drill can
 * touch tenants the user never opened in the UI) should invoke it inside a
 * credential scope that forces silent acquisition.
 *
 * @param tree - The Azure data-layer tree to drill.
 * @param subscriptionId - The subscription id to resolve (e.g. parsed from an
 *   ARM resource id).
 * @param tenantId - (Optional) The owning tenant id. When provided, only that
 *   tenant's subscriptions are searched.
 * @param accountId - (Optional) The owning account id. When provided, only that
 *   account's tenants are searched.
 * @param output - (Optional) Channel used to record skipped tenants.
 */
export async function findSubscriptionById(
    tree: ConcreteAzureNodeTree,
    subscriptionId: string,
    tenantId?: string,
    accountId?: string,
    output?: IOutputChannel,
): Promise<AzureSubscription | undefined> {
    const target = subscriptionId.toLowerCase();
    const targetTenant = tenantId?.toLowerCase();
    const targetAccount = accountId?.toLowerCase();

    for await (const account of drillChildren(tree)) {
        if (targetAccount && isAccount(account) && account.id.toLowerCase() !== targetAccount) {
            continue;
        }

        for await (const tenant of drillChildren(tree, account)) {
            if (!isTenant(tenant)) {
                continue;
            }
            if (targetTenant && tenant.tenantId.toLowerCase() !== targetTenant) {
                continue;
            }

            try {
                for await (const node of drillChildren(tree, tenant)) {
                    if (isSubscription(node) && node.subscriptionId.toLowerCase() === target) {
                        return node;
                    }
                }
            } catch (error) {
                output?.debug(`[auth] skipped tenant ${tenant.tenantId} while resolving subscription: ${stringifyError(error)}`);
            }
        }
    }

    return undefined;
}
