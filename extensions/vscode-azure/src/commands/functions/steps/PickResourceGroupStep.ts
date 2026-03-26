/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isResourceGroup, resourceGroupExperience } from '@microsoft/vscode-azure-azutils';
import { type ICodeContext, PromptStep } from '@microsoft/vscode-azure-utils';
import type { IAzureViewDataTree } from '../../../services';
import type { CreateFunctionAppContext } from '../CreateFunctionAppContext';

/**
 * Prompts the user to pick a resource group by drilling through
 * Account > Tenant > Subscription > Resource Group. Extracts the
 * subscription, resource group name, and region from the pick.
 */
export class PickResourceGroupStep extends PromptStep<CreateFunctionAppContext> {
    public constructor(
        private readonly ctx: ICodeContext,
        private readonly dataTree: IAzureViewDataTree,
    ) {
        super();
    }

    public async prompt(): Promise<Partial<CreateFunctionAppContext>> {
        const key = await resourceGroupExperience({
            ...this.ctx,
            dataItemTree: this.dataTree,
        });

        const node = this.dataTree.get(key);
        if (!node || !isResourceGroup(node)) {
            throw new Error('No resource group was picked');
        }

        return {
            subscription: node.subscription,
            resourceGroupName: node.name,
            region: node.location,
        };
    }
}
