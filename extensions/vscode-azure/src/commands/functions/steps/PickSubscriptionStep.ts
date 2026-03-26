/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isSubscription, subscriptionExperience } from '@microsoft/vscode-azure-azutils';
import { type ICodeContext, PromptStep } from '@microsoft/vscode-azure-utils';
import type { IAzureViewDataTree, IAzureViewViewItemTree } from '../../../services';
import type { CreateFunctionAppContext } from '../CreateFunctionAppContext';

/**
 * Prompts the user to pick an Azure subscription by drilling through
 * the resource tree (Account > Tenant > Subscription).
 */
export class PickSubscriptionStep extends PromptStep<CreateFunctionAppContext> {
    public constructor(
        private readonly ctx: ICodeContext,
        private readonly dataTree: IAzureViewDataTree,
        private readonly viewItemTree: IAzureViewViewItemTree,
    ) {
        super();
    }

    public async prompt(): Promise<Partial<CreateFunctionAppContext>> {
        const key = await subscriptionExperience({
            ...this.ctx,
            viewItemTree: this.viewItemTree,
        });

        const node = this.dataTree.get(key);
        if (!node || !isSubscription(node)) {
            throw new Error('No subscription was picked');
        }

        return { subscription: node };
    }
}
