/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import { type ICodeContext, type IOutputChannel, Wizard } from '@microsoft/vscode-azure-utils';
import type { ConcreteAzureNodeTree } from '../../models/AzureNode';
import type { ResourceGroup } from '../../models/Grouping';
import { type ChooseResourceGroupContext, ChooseResourceGroupStep } from '../../wizard/ChooseResourceGroupStep';

interface ResourceGroupExperienceOptions extends ICodeContext {
    readonly dataItemTree: ConcreteAzureNodeTree;
    readonly output?: IOutputChannel;
}

interface ResourceGroupExperienceResult {
    readonly subscription: AzureSubscription;
    readonly resourceGroup: ResourceGroup;
}

/**
 * Convenience function that runs a wizard with
 * {@linkcode ChooseResourceGroupStep} and returns the picked
 * {@linkcode ResourceGroup} along with its parent
 * {@linkcode AzureSubscription}.
 */
export async function resourceGroupExperience(options: ResourceGroupExperienceOptions): Promise<ResourceGroupExperienceResult> {
    const wizard = new Wizard<ChooseResourceGroupContext>(
        {},
        [new ChooseResourceGroupStep(options)],
        [],
        options.output,
    );

    const result = await wizard.run();

    if (!result.subscription || !result.resourceGroup) {
        throw new Error(options.code.l10n.t('No resource group was picked'));
    }

    return {
        subscription: result.subscription,
        resourceGroup: result.resourceGroup,
    };
}
