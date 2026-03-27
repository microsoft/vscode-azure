/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import {
    getLastPick, RecursivePickStep,
    type ExclusivePickManyOrCreate, type GenericPickOptions, type PickClassification, type PickContext
} from '@microsoft/vscode-azure-utils';
import { isSubscription, type ConcreteAzureNodeTree } from '../models/AzureNode';
import { AzureNodeId } from '../models/AzureNodeId';

/**
 * Context shape required by {@linkcode ChooseSubscriptionStep}.
 * Callers must ensure their wizard context extends this.
 */
export interface ChooseSubscriptionContext extends PickContext<string> {
    readonly subscription?: AzureSubscription;
}

interface ChooseSubscriptionOptions extends Omit<GenericPickOptions<string>, 'canPickMany'> {
    readonly dataItemTree: ConcreteAzureNodeTree;
}

/**
 * A recursive pick step that drills through Account > Tenant >
 * Subscription in the resource tree. When a subscription
 * is picked, sets {@linkcode ChooseSubscriptionContext.subscription}
 * on the wizard context.
 */
export class ChooseSubscriptionStep<TContext extends ChooseSubscriptionContext> extends RecursivePickStep<string, ChooseSubscriptionOptions> {
    public constructor(options: Omit<ChooseSubscriptionOptions, 'classify'>) {
        super(
            {
                ...options,
                classify: (item: string) => classifyForSubscription(AzureNodeId.parse(item))
            } as ChooseSubscriptionOptions & ExclusivePickManyOrCreate<string>,
            ChooseSubscriptionStep,
        );
    }

    public override async prompt(context: Readonly<TContext>): Promise<Partial<TContext>> {
        const pickResult = await super.prompt(context);

        // In order to set the `subscription` property on the context,
        // we need to get the last picked item and see if it's a subscription.
        // If it is, we can pull the subscription info from the node.
        const lastPick = getLastPick({ ...context, ...pickResult });
        if (lastPick && this.options.classify(lastPick.item, lastPick.treeItem) === 'terminal') {
            const node = this.options.dataItemTree.get(lastPick.item);
            if (node && isSubscription(node)) {
                return { ...pickResult, subscription: node } as Partial<TContext>;
            }
        }

        return pickResult as Partial<TContext>;
    }
}

function classifyForSubscription(nodeId: AzureNodeId): PickClassification {
    if (nodeId.isAccountNodeId() || nodeId.isTenantNodeId()) {
        return 'intermediate';
    } else if (nodeId.isSubscriptionNodeId()) {
        return 'terminal';
    }
    return false;
}
