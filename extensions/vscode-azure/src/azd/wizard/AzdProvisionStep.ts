/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription, AzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import { parseAzureResourceId } from '@microsoft/vscode-azure-azutils';
import { ExecuteStep, type ICodeContext, IOutputChannel } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';
import { ArmDeploymentDataProvider } from '../../tree/activity/ArmDeploymentDataProvider';
import type { IAzdService } from '../AzdService';
import type { TempDirManager } from '../TempDirManager';
import type { AzdWizardContext } from './AzdWizardContext';

/** Parsed deployment information extracted from the deployment ID file. */
interface AzdDeploymentInfo {
    readonly deploymentId: string;
    readonly subscriptionId: string;
}

/** Interval in milliseconds between polls for the deployment ID file. */
const deployIdPollIntervalMs = 3000;
/** Maximum time in milliseconds to poll for the deployment ID file. */
const deployIdPollTimeoutMs = 120_000;

/**
 * Runs `azd provision` as a visible VS Code task.
 *
 * Sets `AZD_DEPLOYMENT_ID_FILE` so azd writes the ARM deployment ID
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
        private readonly tempDirManager: TempDirManager,
    ) {
        super();
    }

    public override shouldExecute(context: Readonly<TContext>): boolean {
        return context.provision === true && !!context.iacFolder;
    }

    public async execute(context: TContext): Promise<void> {
        // Create a temp directory for the deployment ID file
        const deployIdDir = await this.tempDirManager.createTempDir();
        const deployIdFileUri = this.ctx.code.Uri.joinPath(deployIdDir, 'deployment-id.json');

        // Poll for the deployment ID file (non-blocking)
        void this.trackDeployment(deployIdFileUri);

        await this.azd.provision(context.iacFolder!, { // eslint-disable-line @typescript-eslint/no-non-null-assertion
            AZD_DEPLOYMENT_ID_FILE: deployIdFileUri.fsPath, // eslint-disable-line @typescript-eslint/naming-convention
        });
    }

    /**
     * Polls for the deployment ID file and starts tracking the ARM
     * deployment in the activity view. Best-effort; errors are swallowed.
     */
    private async trackDeployment(deployIdFileUri: vscode.Uri): Promise<void> {
        try {
            const info = await this.pollForDeploymentIdFile(deployIdFileUri);
            if (!info) {
                this.output.debug('[provision] no deployment ID found');
                return;
            }
            this.output.debug(`[provision] found deployment ID: ${info.deploymentId}`);
            const subscription = await this.resolveSubscription(info.subscriptionId);
            if (subscription) {
                this.armProvider.trackDeployment(info.deploymentId, subscription);
            }
        } catch {
            // Best-effort; errors are swallowed
        }
    }

    /**
     * Polls for the deployment ID file to appear. Checks every
     * {@linkcode deployIdPollIntervalMs} for up to {@linkcode deployIdPollTimeoutMs}.
     */
    private async pollForDeploymentIdFile(fileUri: vscode.Uri): Promise<AzdDeploymentInfo | undefined> {
        const start = Date.now();
        while (Date.now() - start < deployIdPollTimeoutMs) {
            try {
                const content = await this.ctx.code.workspace.fs.readFile(fileUri);
                const text = new TextDecoder().decode(content);
                const parsed = JSON.parse(text) as { deploymentId?: string };
                if (parsed.deploymentId) {
                    const { subscriptionId } = parseAzureResourceId(parsed.deploymentId);
                    return { deploymentId: parsed.deploymentId, subscriptionId };
                }
            } catch {
                // File doesn't exist yet or isn't valid -- keep polling
            }
            await new Promise(resolve => setTimeout(resolve, deployIdPollIntervalMs));
        }
        return undefined;
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
