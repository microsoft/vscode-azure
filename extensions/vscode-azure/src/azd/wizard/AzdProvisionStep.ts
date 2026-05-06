/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription, AzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import { ExecuteStep, type ICodeContext, IOutputChannel } from '@microsoft/vscode-azure-utils';
import { ArmDeploymentDataProvider } from '../../tree/activity/ArmDeploymentDataProvider';
import type { IAzdService } from '../AzdService';
import type { AzdWizardContext } from './AzdWizardContext';

/**
 * Runs `azd provision` in a visible terminal.
 *
 * Passes `AZD_DEPLOYMENT_ID_FILE` so azd writes the ARM deployment ID
 * to a temp file. Polls for that file to start tracking the deployment
 * in the activity view via {@linkcode ArmDeploymentDataProvider}.
 */
export class AzdProvisionStep<TContext extends AzdWizardContext> extends ExecuteStep<TContext> {
    public constructor(
        private readonly ctx: ICodeContext,
        private readonly azd: IAzdService,
        private readonly output: IOutputChannel,
        private readonly armProvider: ArmDeploymentDataProvider,
        private readonly subscriptionProvider: AzureSubscriptionProvider,
    ) {
        super();
    }

    public override shouldExecute(context: Readonly<TContext>): boolean {
        return context.provision === true && !!context.iacFolder;
    }

    public async execute(context: TContext): Promise<void> {
        const storageDir = this.ctx.extensionContext.storageUri ?? this.ctx.extensionContext.globalStorageUri;
        const result = await this.azd.provisionWithCapture(context.iacFolder!, storageDir); // eslint-disable-line @typescript-eslint/no-non-null-assertion

        // Track ARM deployment as soon as we find the ID (non-blocking)
        result.deploymentInfo.then(async (info) => {
            if (!info) {
                this.output.debug('[provision] no deployment ID found in output');
                return;
            }
            this.output.debug(`[provision] found deployment ID: ${info.deploymentId}`);
            const subscription = await this.resolveSubscription(info.subscriptionId);
            if (subscription) {
                this.armProvider.trackDeployment(info.deploymentId, subscription);
            }
        }).catch(() => { /* tracked non-blocking; errors are swallowed */ });

        await result.completed;
    }

    private async resolveSubscription(subscriptionId: string): Promise<AzureSubscription | undefined> {
        try {
            const subscriptions = await this.subscriptionProvider.getAvailableSubscriptions();
            return subscriptions.find(s => s.subscriptionId.toLowerCase() === subscriptionId.toLowerCase());
        } catch {
            this.output.debug(`[provision] failed to resolve subscription ${subscriptionId}`);
        }
        return undefined;
    }
}
