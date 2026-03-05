/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getLastPick, RecursivePickStep, Wizard, type ICodeContext, type ITreeItem, type PickContext } from '@microsoft/vscode-azure-utils';
import { isAccount, isResourceGroup, isSubscription, isTenant, type ConcreteAzureNode, type ConcreteAzureNodeTree } from '../../models/AzureNode';
import { AzureNodeId } from '../../models/AzureNodeId';

interface ResourceGroupExperienceOptions extends ICodeContext {
    readonly dataItemTree: ConcreteAzureNodeTree;
}

export async function resourceGroupExperience(options: ResourceGroupExperienceOptions): Promise<string> {
    const wizard = new Wizard<PickContext<string>>(
        {
            picks: [],
        },
        [
            new RecursivePickStep<string>({
                ...options,
                isIntermediate: key => {
                    const nodeId = AzureNodeId.parse(key);
                    return nodeId.isAccountNodeId() || nodeId.isTenantNodeId() || nodeId.isSubscriptionNodeId();
                },
                isTerminal: key => {
                    const nodeId = AzureNodeId.parse(key);
                    return nodeId.isResourceGroupNodeId();
                },
                tree: new ResourceGroupViewItemTree(options.dataItemTree),
            }),
        ]
    );

    const result = await wizard.run();
    const resourceGroupPick = getLastPick(result);

    if (!resourceGroupPick) {
        // TODO: unexpected state
        throw new Error('No resource group was picked');
    }

    return resourceGroupPick.item;
}

// TODO: is this terrible?
class ResourceGroupViewItemTree {
    public constructor(private readonly dataItemTree: ConcreteAzureNodeTree) { }

    public async getChildren(key?: string): Promise<string[]> {
        let node: ConcreteAzureNode | undefined = undefined;
        if (key) {
            node = this.dataItemTree.get(key);
            if (!node) {
                throw new Error(`Could not find node for key: ${key}`);
            }
        }
        return (await this.dataItemTree.getChildren(node)).map(child => AzureNodeId.from(child).toString());
    }

    public getTreeItem(key: string): ITreeItem {
        const node = this.dataItemTree.get(key);
        if (!node) {
            throw new Error(`Could not find node for key: ${key}`);
        }

        switch (true) {
            case isAccount(node):
                return {
                    label: node.label,
                    id: key,
                    // TODO: more details
                };
            case isTenant(node):
                return {
                    label: node.displayName,
                    id: key,
                    // TODO: more details
                };
            case isSubscription(node):
                return {
                    label: node.name,
                    id: key,
                    // TODO: more details
                };
            case isResourceGroup(node):
                return {
                    label: node.name,
                    id: key,
                    // TODO: more details
                };
            default:
                throw new Error(`Unexpected node: ${key}`);
        }
    }
}
