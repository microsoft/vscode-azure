/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import { type DataItemTree, getLastPick, type IExtensionContext, type IVsCode, type PickContext, RecursivePickStep, type ViewItemTree, Wizard } from '@microsoft/vscode-azure-utils';
import { AzureNodeId } from 'src/models/AzureNodeId';
import type { AzureNode } from '../../models/AzureNode';

type SubscriptionExperienceOptions = {
    code: IVsCode;
    extensionContext: IExtensionContext;
    tree: ViewItemTree<string, AzureNode>;
    dataItemTree: DataItemTree<AzureNode>;
};

export async function subscriptionExperience(options: SubscriptionExperienceOptions): Promise<AzureSubscription> {
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
                    return nodeId.isAccountNodeId() || nodeId.isTenantNodeId();
                },
                isTerminal: item => {
                    const nodeId = AzureNodeId.parse(item);
                    return nodeId.isSubscriptionNodeId();
                },
                tree: options.tree,
            }),
        ]
    );

    const result = await wizard.run();
    const subscriptionPick = getLastPick(result);

    if (!subscriptionPick) {
        // TODO: unexpected state
        throw new Error('No subscription was picked');
    }

    return options.dataItemTree.get(subscriptionPick.item) as AzureSubscription;
}
