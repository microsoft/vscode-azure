/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ICodeContext, type IOutputChannel, type ViewItemTree, Wizard } from '@microsoft/vscode-azure-utils';
import type { AzureSubscription } from '../../auth/AzureSubscription';
import type { AzureNode, ConcreteAzureNodeTree } from '../../models/AzureNode';
import { type ChooseSubscriptionContext, ChooseSubscriptionStep } from '../../wizard/ChooseSubscriptionStep';

interface SubscriptionExperienceOptions extends ICodeContext {
    readonly tree: ViewItemTree<string, AzureNode>;
    readonly dataItemTree: ConcreteAzureNodeTree;
    readonly output: IOutputChannel;
}

/**
 * Convenience function that runs a wizard with
 * {@linkcode ChooseSubscriptionStep} and returns the picked
 * {@linkcode AzureSubscription}.
 */
export async function subscriptionExperience(options: SubscriptionExperienceOptions): Promise<AzureSubscription> {
    const wizard = new Wizard<ChooseSubscriptionContext>(
        options.output,
        {},
        [new ChooseSubscriptionStep(options)],
    );

    const result = await wizard.run();

    if (!result.subscription) {
        throw new Error(options.code.l10n.t('No subscription was picked'));
    }

    return result.subscription;
}
