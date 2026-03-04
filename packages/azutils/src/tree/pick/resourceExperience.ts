/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DataItemTree, getLastPick, type IExtensionContext, type IVsCode, type PickContext, RecursivePickStep, type ViewItemTree, Wizard } from '@microsoft/vscode-azure-utils';
import { AzureNodeId } from 'src/models/AzureNodeId';
import { GenericResource } from 'src/models/GenericResource';
import type { AzureNode } from '../../models/AzureNode';

type ResourceExperienceOptions = {
    code: IVsCode;
    extensionContext: IExtensionContext;
    tree: ViewItemTree<string, AzureNode>;
    dataItemTree: DataItemTree<AzureNode>;
} & (
        { resourceType: string } | // experience for a specific resource type
        { isResourceMatch: (node: AzureNode) => boolean } // experience for a specific set of resources determined by a function
    );

export async function resourceExperience<TResource extends GenericResource>(options: ResourceExperienceOptions): Promise<TResource> {
    const wizard = new Wizard<PickContext<string>>(
        {
            picks: [],
        },
        [
            new RecursivePickStep<string>({
                code: options.code,
                extensionContext: options.extensionContext,
                isIntermediate: item => {
                    const nodeId = AzureNodeId.parse(item);
                    return nodeId.isAccountNodeId() || nodeId.isTenantNodeId() || nodeId.isResourceGroupNodeId() || nodeId.isVirtualGroupNodeId();
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
                tree: options.tree,
            }),
        ]
    );

    const result = await wizard.run();
    const resourcePick = getLastPick(result);

    if (!resourcePick) {
        // TODO: unexpected state
        throw new Error('No resource was picked');
    }

    return options.dataItemTree.get(resourcePick.item) as TResource;
}
