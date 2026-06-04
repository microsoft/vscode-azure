/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription, AzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import { parseAzureResourceId } from '@microsoft/vscode-azure-azutils';
import { CancellationError, delay, ExecuteStep, stringifyError, type ICodeContext, type IOutputChannel } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';
import type { ArmDeploymentDataProvider } from '../../tree/activity/ArmDeploymentDataProvider';
import type { IAzdService } from '../AzdService';
import type { ITempDirManager } from '../TempDirManager';
import type { AzdWizardContext } from './AzdWizardContext';

/** A single line from the JSONL deployment ID file written by azd. */
interface DeploymentIdEntry {
    readonly deploymentId: string;
}

/** Interval in milliseconds between polls for the deployment ID file. */
const pollIntervalMs = 3000;

/**
 * Runs `azd provision` as a visible VS Code task.
 *
 * Sets `AZD_DEPLOYMENT_ID_FILE` so azd writes ARM deployment IDs
 * as JSONL. Polls for that file to start tracking each deployment
 * in the activity view via {@linkcode ArmDeploymentDataProvider}.
 */
export class AzdProvisionStep<TContext extends AzdWizardContext> extends ExecuteStep<TContext> {
    public constructor(
        private readonly ctx: ICodeContext,
        private readonly azd: IAzdService,
        private readonly output: IOutputChannel,
        private readonly armProvider: ArmDeploymentDataProvider,
        private readonly subscriptionProvider: AzureSubscriptionProvider,
        private readonly tempDirManager: ITempDirManager,
    ) {
        super();
    }

    public override shouldExecute(context: Readonly<TContext>): boolean {
        return context.provision === true && !!context.iacFolder;
    }

    public async execute(context: TContext): Promise<void> {
        const deployIdDir = await this.tempDirManager.createTempDir();
        const deployIdFileUri = this.ctx.code.Uri.joinPath(deployIdDir, 'deployment-id.jsonl');

        const abortCtl = new AbortController();
        const trackedIds = new Set<string>();

        // Start polling in the background (fire-and-forget)
        void this.pollLoop(deployIdFileUri, trackedIds, abortCtl.signal);

        try {
            await this.azd.provision(context.iacFolder!, { // eslint-disable-line @typescript-eslint/no-non-null-assertion
                AZD_DEPLOYMENT_ID_FILE: deployIdFileUri.fsPath, // eslint-disable-line @typescript-eslint/naming-convention
            });
        } finally {
            abortCtl.abort();
            // Final read to catch any entries written just before exit
            await this.readAndTrack(deployIdFileUri, trackedIds);
        }
    }

    /**
     * Polls the deployment ID file every {@linkcode pollIntervalMs} until
     * the abort signal fires. Each poll reads the entire file, parses
     * JSONL entries, and starts tracking any new deployment IDs.
     *
     * Polling lifetime is tied to the `azd provision` task, **not** to the
     * visibility of the resulting activities. Clearing a tracked deployment
     * does not stop discovery of additional deployments produced by the
     * still-running provision -- a brand new deployment is a brand new event
     * and should appear in the tree.
     */
    private async pollLoop(fileUri: vscode.Uri, trackedIds: Set<string>, signal: AbortSignal): Promise<void> {
        try {
            while (!signal.aborted) {
                await this.readAndTrack(fileUri, trackedIds);
                await delay(pollIntervalMs, { signal });
            }
        } catch (e) {
            if (!CancellationError.test(e)) {
                this.output.debug(`[provision] deployment ID polling failed: ${stringifyError(e)}`);
            }
        }
    }

    /**
     * Reads the deployment ID file and starts tracking any entries
     * not already in {@linkcode trackedIds}. Best-effort: silently
     * ignores missing files, parse errors, and subscription resolution
     * failures.
     */
    private async readAndTrack(fileUri: vscode.Uri, trackedIds: Set<string>): Promise<void> {
        const entries = await this.readDeploymentIdFile(fileUri);
        for (const entry of entries) {
            if (trackedIds.has(entry.deploymentId)) {
                continue;
            }
            trackedIds.add(entry.deploymentId);
            this.output.debug(`[provision] found deployment ID: ${entry.deploymentId}`);

            try {
                const { subscriptionId } = parseAzureResourceId(entry.deploymentId);
                const subscription = await this.resolveSubscription(subscriptionId);
                if (subscription) {
                    this.armProvider.trackDeployment(entry.deploymentId, subscription);
                }
            } catch {
                this.output.debug(`[provision] failed to track deployment: ${entry.deploymentId}`);
            }
        }
    }

    /**
     * Reads and parses the JSONL deployment ID file. Returns an empty
     * array when the file doesn't exist or can't be read.
     */
    private async readDeploymentIdFile(fileUri: vscode.Uri): Promise<DeploymentIdEntry[]> {
        try {
            const content = await this.ctx.code.workspace.fs.readFile(fileUri);
            const text = new TextDecoder().decode(content);
            const entries: DeploymentIdEntry[] = [];
            for (const line of text.split('\n')) {
                const trimmed = line.trim();
                if (trimmed.length === 0) {
                    continue;
                }
                try {
                    const parsed = JSON.parse(trimmed) as DeploymentIdEntry;
                    if (parsed.deploymentId) {
                        entries.push(parsed);
                    }
                } catch {
                    // Skip malformed lines
                }
            }
            return entries;
        } catch {
            return [];
        }
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
