/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CreateNewOption, getLastPick, type ICodeContext, type PickContext, RecursivePickStep, type ViewItemTree, Wizard } from '@microsoft/vscode-azure-utils';
import type { AzureNode, ConcreteAzureNode, ConcreteAzureNodeTree } from '../../models/AzureNode';
import { AzureNodeId } from '../../models/AzureNodeId';
import type { GenericResource } from '../../models/GenericResource';

type ResourceExperienceOptions = ICodeContext & {
    readonly viewItemTree: ViewItemTree<string, AzureNode>;
    readonly dataItemTree: ConcreteAzureNodeTree;
    readonly canPickMany?: boolean;
    readonly create?: CreateNewOption<string>;
} & (
        { readonly resourceType: string } | // Look for a specific resource type
        { readonly isResourceMatch: (node: ConcreteAzureNode) => boolean } // Look for a resource that matches a certain condition (e.g. use for functions where type alone isn't enough) // TODO: use a logical type
    );

export async function resourceExperience(options: ResourceExperienceOptions & { canPickMany?: false, create?: CreateNewOption<string> }): Promise<string>;
export async function resourceExperience(options: ResourceExperienceOptions & { canPickMany: true, create?: never }): Promise<string[]>;
export async function resourceExperience(options: ResourceExperienceOptions): Promise<string | string[]> {
    const wizard = new Wizard<PickContext<string>>(
        {
            picks: [],
        },
        [
            new RecursivePickStep<string>({
                ...options,
                isIntermediate: item => {
                    const nodeId = AzureNodeId.parse(item);

                    if (nodeId.isVirtualGroupNodeId() && isMatchingResourceTypeGroup(nodeId, options)) { // TODO: logical type
                        return true;
                    }

                    return nodeId.isAccountNodeId()
                        || nodeId.isTenantNodeId()
                        || nodeId.isSubscriptionNodeId()
                        || nodeId.isResourceGroupNodeId()
                        || nodeId.isVirtualGroupNodeId();
                },
                isTerminal: item => {
                    const nodeId = AzureNodeId.parse(item);

                    if (nodeId.isGenericResourceNodeId()) {
                        const node = options.dataItemTree.get(item) as GenericResource;
                        if ('resourceType' in options) {
                            return node.type.toLowerCase() === options.resourceType.toLowerCase();
                        } else if ('isResourceMatch' in options) {
                            return options.isResourceMatch(node);
                        }
                    }

                    return false;
                },
                shouldSkipIfOne: item => {
                    // Skip intermediate if it's a virtual grouping, by resource type, and we already know the resource type we're looking for
                    const nodeId = AzureNodeId.parse(item);
                    return nodeId.isVirtualGroupNodeId() && isMatchingResourceTypeGroup(nodeId, options); // TODO: logical type
                },
                tree: options.viewItemTree,
            }),
        ]
    );

    const result = await wizard.run();

    if (options.canPickMany) {
        return result.selectedTerminalPicks ?? [];
    } else {
        const resourcePick = getLastPick(result);

        if (!resourcePick) {
            // TODO: unexpected state
            throw new Error('No resource was picked');
        }

        return resourcePick.item;
    }
}

/**
 * Returns `true` when the virtual group node uses the `resourceType` strategy
 * and its value matches the resource type the caller is looking for.
 *
 * When the caller uses `isResourceMatch` instead of `resourceType`, we cannot
 * determine ahead of time which group is the right one, so this returns `false`.
 */
function isMatchingResourceTypeGroup(nodeId: AzureNodeId, options: ResourceExperienceOptions): boolean {
    if (!('resourceType' in options)) {
        return false;
    }

    const grouping = nodeId.getGrouping();
    return grouping?.groupingStrategy === 'resourceType'
        && grouping.groupingValue.toLowerCase() === options.resourceType.toLowerCase();
}
