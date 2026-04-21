/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription, AzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import { parseAzureResourceId } from '@microsoft/vscode-azure-azutils';
import { CancellationError, IActionContext, IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureSubscriptionProvider } from '../services';
import { ArmDeploymentDataProvider, parseDeploymentId } from '../tree/activity/ArmDeploymentDataProvider';
import type { ManagedCommand } from './ManagedCommand';

/* c8 ignore start */

/**
 * Starts tracking an existing ARM deployment in the activity view.
 *
 * Prompts the user for either a raw ARM deployment resource ID or an
 * Azure Portal deployment blade URL, resolves the owning subscription
 * from the signed-in accounts, then hands the deployment off to
 * {@linkcode ArmDeploymentDataProvider}.
 *
 * TODO: This is a temporary demonstration command just to kick off tracking an existing ARM deployment.
 */
@injectable()
export class TrackArmDeployment implements ManagedCommand {
    public constructor(
        @inject(IActionContext) private readonly context: IActionContext,
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(ArmDeploymentDataProvider) private readonly armProvider: ArmDeploymentDataProvider,
        @inject(IAzureSubscriptionProvider) private readonly subscriptionProvider: AzureSubscriptionProvider,
    ) { }

    /** @inheritdoc */
    public async execute(): Promise<void> {
        const rawInput = await this.code.window.showInputBox({
            prompt: this.code.l10n.t('Enter an ARM deployment resource ID or Azure Portal deployment URL'),
            placeHolder: '/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Resources/deployments/{name}',
            validateInput: (value) => {
                try {
                    parseDeploymentId(extractDeploymentId(value));
                    return undefined;
                } catch {
                    return this.code.l10n.t('Must be an ARM deployment resource ID or Azure Portal deployment URL');
                }
            },
        });

        if (!rawInput) {
            throw new CancellationError('Canceled', 'deploymentId');
        }

        const deploymentId = extractDeploymentId(rawInput);

        let subscriptionId: string | undefined;
        try {
            subscriptionId = parseAzureResourceId(deploymentId).subscriptionId;
        } catch {
            // Deployment ID may not contain a subscription (e.g. tenant-scoped)
        }

        if (!subscriptionId) {
            void this.code.window.showErrorMessage(
                this.code.l10n.t('Only subscription-scoped and resource-group-scoped deployments are supported at this time'),
            );
            return;
        }

        const subscription = await this.resolveSubscription(subscriptionId);

        if (!subscription) {
            void this.code.window.showErrorMessage(
                this.code.l10n.t('Could not find a signed-in subscription matching "{0}"', subscriptionId),
            );
            return;
        }

        this.armProvider.trackDeployment(deploymentId, subscription);

        const { deploymentName } = parseDeploymentId(deploymentId);
        void this.code.window.showInformationMessage(
            this.code.l10n.t('Tracking deployment: {0}', deploymentName),
        );
    }

    private async resolveSubscription(subscriptionId: string): Promise<AzureSubscription | undefined> {
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

const portalDeploymentPattern = /DeploymentDetailsBlade.*\/id\/(.+)/i;

/**
 * Extracts an ARM deployment resource ID from either a raw ARM ID or an
 * Azure Portal deployment URL.
 *
 * Portal URLs look like:
 * `https://portal.azure.com/#blade/HubsExtension/DeploymentDetailsBlade/id/%2Fsubscriptions%2F...`
 */
function extractDeploymentId(input: string): string {
    const trimmed = input.trim();
    const match = portalDeploymentPattern.exec(trimmed);
    if (match) {
        return decodeURIComponent(match[1]);
    }
    return trimmed;
}
