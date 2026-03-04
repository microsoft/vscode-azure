/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getLastPick, PickContext, RecursivePickStep, Wizard, type DataItemTree, type IExtensionContext, type IVsCode } from '@microsoft/vscode-azure-utils';
import { isAccount, isResourceGroup, isSubscription, isTenant, type AzureNode } from '../../models/AzureNode';
import type { ResourceGroup } from '../../models/Grouping';

type ResourceGroupExperienceOptions = {
    code: IVsCode;
    extensionContext: IExtensionContext;
    dataItemTree: DataItemTree<AzureNode>;
};

export async function resourceGroupExperience(options: ResourceGroupExperienceOptions): Promise<ResourceGroup> {
    const wizard = new Wizard<PickContext<AzureNode>>(
        {
            picks: [],
        },
        [
            new RecursivePickStep<AzureNode>({
                code: options.code,
                extensionContext: options.extensionContext,
                isIntermediate: item => isAccount(item) || isTenant(item) || isSubscription(item),
                isTerminal: item => isResourceGroup(item),
                tree: options.dataItemTree, // TODO: need to be able to use this data tree somehow?
            }),
        ]
    );

    const result = await wizard.run();
    const resourceGroupPick = getLastPick(result);

    if (!resourceGroupPick) {
        // TODO: unexpected state
        throw new Error('No resource group was picked');
    }

    return resourceGroupPick.item as ResourceGroup;
}
