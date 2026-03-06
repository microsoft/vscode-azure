/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CreateNewOption, getLastPick, type ICodeContext, type PickClassification, type PickContext, RecursivePickStep, type ViewItemTree, Wizard } from '@microsoft/vscode-azure-utils';
import type { ConcreteAzureNode, ConcreteAzureNodeTree } from '../../models/AzureNode';
import { AzureNodeId } from '../../models/AzureNodeId';
import type { GenericResource } from '../../models/GenericResource';

interface ResourceExperienceOptions extends ICodeContext {
    readonly viewItemTree: ViewItemTree<string, ConcreteAzureNode>;
    readonly dataItemTree: ConcreteAzureNodeTree;
    readonly logicalType: string;
    readonly canPickMany?: boolean;
    readonly create?: CreateNewOption<string>;
}

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
                classify: item => classifyForResource(AzureNodeId.parse(item), item, options),
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

function classifyForResource(nodeId: AzureNodeId, item: string, options: ResourceExperienceOptions): PickClassification {
    if (nodeId.isGenericResourceNodeId()) {
        const node = options.dataItemTree.get(item) as GenericResource;
        return node.logicalType.toLowerCase() === options.logicalType.toLowerCase() ? 'terminal' : false;
    }

    // Virtual groupings that match the target resource type can be auto-skipped
    if (nodeId.isVirtualGroupNodeId() && isMatchingResourceTypeGroup(nodeId, options)) {
        return 'skip';
    }

    if (nodeId.isAccountNodeId()
        || nodeId.isTenantNodeId()
        || nodeId.isSubscriptionNodeId()
        || nodeId.isResourceGroupNodeId()
        || nodeId.isVirtualGroupNodeId()) {
        return 'intermediate';
    }

    return false;
}

/**
 * Returns `true` when the virtual group node uses the `resourceType` strategy
 * and its value matches the resource type the caller is looking for.
 */
function isMatchingResourceTypeGroup(nodeId: AzureNodeId, options: ResourceExperienceOptions): boolean {
    const grouping = nodeId.getGrouping();
    return grouping?.groupingStrategy === 'resourceType'
        && grouping.groupingValue.toLowerCase() === options.logicalType.toLowerCase();
}
