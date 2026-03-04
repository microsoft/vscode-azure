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
        { readonly isResourceMatch: (node: ConcreteAzureNode) => boolean } // Look for a resource that matches a certain condition (e.g. use for functions where type alone isn't enough)
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
