/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getLastPick, type ICodeContext, type PickClassification, type PickContext, RecursivePickStep, type ViewItemTree, Wizard } from '@microsoft/vscode-azure-utils';
import type { AzureNode } from '../../models/AzureNode';
import { AzureNodeId } from '../../models/AzureNodeId';

interface SubscriptionExperienceOptions extends ICodeContext {
    readonly viewItemTree: ViewItemTree<string, AzureNode>;
}

export async function subscriptionExperience(options: SubscriptionExperienceOptions): Promise<string> {
    const wizard = new Wizard<PickContext<string>>(
        {
            picks: [],
        },
        [
            new RecursivePickStep<string>({
                ...options,
                classify: item => classifyForSubscription(AzureNodeId.parse(item)),
                tree: options.viewItemTree,
            }),
        ]
    );

    const result = await wizard.run();
    const subscriptionPick = getLastPick(result);

    if (!subscriptionPick) {
        // TODO: unexpected state
        throw new Error('No subscription was picked');
    }

    return subscriptionPick.item;
}

function classifyForSubscription(nodeId: AzureNodeId): PickClassification {
    if (nodeId.isAccountNodeId() || nodeId.isTenantNodeId()) {
        return 'intermediate';
    } else if (nodeId.isSubscriptionNodeId()) {
        return 'terminal';
    }
    return false;
}
