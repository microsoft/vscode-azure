/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { drillChildren } from '@microsoft/vscode-azure-utils';
import { isGenericResource, isResourceGroup, type ConcreteAzureNodeTree } from '../models/AzureNode';
import type { GenericResource } from '../models/GenericResource';
import { parseAzureResourceId } from '../utils/azureResourceId';
import { findSubscriptionById } from './findSubscriptionById';

/**
 * Resolve a {@linkcode GenericResource} from its ARM id by drilling the data tree
 * (account -> tenant -> subscription -> resource group -> resource).
 *
 * Unlike {@linkcode ConcreteAzureNodeTree.get DataItemTree.get}, this does not require the caller to
 * know the node's hierarchical key, and it force-loads each level, so it resolves a resource even
 * when the tree has never been expanded in the UI. That makes it the right tool for restoring state
 * that outlives the tree -- for example an editor reopened after a window reload, which holds only a
 * URI.
 *
 * Only the owning resource group is listed, not every group in the subscription, so the cost is one
 * resource-group page walk plus one resource page walk. Loaded levels are cached by the tree, so
 * repeated lookups are cheap.
 *
 * Comparison is case-insensitive throughout, as ARM ids are case-insensitive.
 *
 * @param tree - The Azure data-layer tree to drill.
 * @param armResourceId - Full ARM id, e.g. `/subscriptions/.../providers/Microsoft.Web/sites/my-app`.
 * @param tenantId - (Optional) The owning tenant id, to narrow the subscription drill.
 * @param accountId - (Optional) The owning account id, to narrow the subscription drill.
 * @returns the resource, or `undefined` when no signed-in account exposes it, or when the id names
 * something other than a resource-group-scoped resource.
 * @throws if {@linkcode armResourceId} is not a parseable ARM id at all. A caller holding an id from
 * an untrusted source (a hand-edited URI, say) should be prepared for this.
 */
export async function findResourceByArmId(
    tree: ConcreteAzureNodeTree,
    armResourceId: string,
    tenantId?: string,
    accountId?: string,
): Promise<GenericResource | undefined> {
    const parsed = parseAzureResourceId(armResourceId);
    if (!parsed.subscriptionId || !parsed.resourceGroup) {
        return undefined;
    }

    const subscription = await findSubscriptionById(tree, parsed.subscriptionId, tenantId, accountId);
    if (!subscription) {
        return undefined;
    }

    const targetGroup = parsed.resourceGroup.toLowerCase();
    const targetId = armResourceId.toLowerCase();

    for await (const group of drillChildren(tree, subscription)) {
        if (!isResourceGroup(group) || group.name.toLowerCase() !== targetGroup) {
            continue;
        }

        for await (const resource of drillChildren(tree, group)) {
            if (isGenericResource(resource) && resource.id.toLowerCase() === targetId) {
                return resource;
            }
        }

        // The owning group was found and fully walked; no other group can hold this id.
        return undefined;
    }

    return undefined;
}
