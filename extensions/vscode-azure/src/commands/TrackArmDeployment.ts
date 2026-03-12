/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import { parseAzureResourceId } from '@microsoft/vscode-azure-azutils';
import { IActionContext, IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureSubscriptionProvider } from '../services';
import { ArmDeploymentDataProvider } from '../tree/activity/ArmDeploymentDataProvider';
import type { ManagedCommand } from './ManagedCommand';

@injectable()
export class TrackArmDeployment implements ManagedCommand {
    public constructor(
        @inject(IActionContext) private readonly context: IActionContext,
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(ArmDeploymentDataProvider) private readonly armProvider: ArmDeploymentDataProvider,
        @inject(IAzureSubscriptionProvider) private readonly subscriptionProvider: AzureSubscriptionProvider,
    ) { }

    public async execute(): Promise<void> {
        const deploymentId = await this.code.window.showInputBox({
            prompt: this.code.l10n.t('Enter the full ARM resource ID of the deployment to track'),
            placeHolder: '/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Resources/deployments/{name}',
            validateInput: (value) => {
                try {
                    const parsed = parseAzureResourceId(value);
                    if (!parsed.resourceGroup || !parsed.resourceName) {
                        return this.code.l10n.t('Must be a full ARM resource ID including resource group and deployment name');
                    }
                    if (parsed.provider?.toLowerCase() !== 'microsoft.resources'
                        || parsed.resourceType?.toLowerCase() !== 'deployments') {
                        return this.code.l10n.t('Must be a Microsoft.Resources/deployments resource ID');
                    }
                    return undefined;
                } catch {
                    return this.code.l10n.t('Invalid ARM resource ID');
                }
            },
        });

        if (!deploymentId) {
            this.context.telemetry.properties.cancelStep = 'deploymentId';
            return;
        }

        const parsed = parseAzureResourceId(deploymentId);
        const subscription = await this.resolveSubscription(parsed.subscriptionId);

        if (!subscription) {
            void this.code.window.showErrorMessage(
                this.code.l10n.t('Could not find a signed-in subscription matching "{0}"', parsed.subscriptionId),
            );
            return;
        }

        this.armProvider.trackDeployment(deploymentId, subscription);
        void this.code.window.showInformationMessage(
            this.code.l10n.t('Tracking deployment: {0}', parsed.resourceName ?? deploymentId),
        );
    }

    private async resolveSubscription(subscriptionId: string) {
        await this.subscriptionProvider.signIn();

        const accounts = await this.subscriptionProvider.getAccounts();
        for (const account of accounts) {
            const tenants = await this.subscriptionProvider.getTenantsForAccount(account);
            for (const tenant of tenants) {
                const subscriptions = await this.subscriptionProvider.getSubscriptionsForTenant(tenant);
                const match = subscriptions.find(s => s.subscriptionId.toLowerCase() === subscriptionId.toLowerCase());
                if (match) {
                    return match;
                }
            }
        }
        return undefined;
    }
}
