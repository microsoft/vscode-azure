/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    IContainerAppsClientProvider, ILogsQueryClientProvider,
    parseAzureResourceId, type AzureSubscription,
} from '@microsoft/vscode-azure-azutils';
import {
    delay, ExecuteStep, IOutputChannel, IVsCode, showMessage, stringifyError,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzdService } from '../../../azd/AzdService';
import { ISubscriptionResolver } from '../../../services';
import type { CreateContainerAppContext } from '../CreateContainerAppContext';

/** How long to wait for a revision to settle before giving up. */
const SettleTimeoutMs = 120_000;
/** Gap between revision polls. */
const PollIntervalMs = 5_000;
/** How far back to read console logs when a revision fails to start. */
const LogWindowMinutes = 5;
/** Most log lines to surface; a crash loop can produce thousands. */
const MaxLogLines = 50;

/** States a revision passes through before it has settled either way. */
const TransientStates = new Set(['processing', 'activating', 'provisioning', 'deprovisioning']);
/** States that mean the revision is healthy. A scaled-to-zero app is healthy. */
const HealthyStates = new Set(['running', 'scaledtozero']);

/**
 * Verifies that the provisioned container app actually started, and explains it
 * when it did not.
 *
 * Provisioning succeeding only means ARM accepted the template; the container
 * can still fail to start -- a bad image reference, a crash on boot, a missing
 * environment variable. Without this the wizard reports success and the user
 * discovers the failure later, with no clue where to look.
 *
 * On failure the app's own console logs are read from the environment's Log
 * Analytics workspace and written to the output channel, which is where the
 * explanation actually lives.
 *
 * This never throws. The resource exists either way, so failing the wizard here
 * would misreport what happened.
 */
@injectable()
export class VerifyContainerAppStartStep extends ExecuteStep<CreateContainerAppContext> {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IOutputChannel) private readonly output: IOutputChannel,
        @inject(IAzdService) private readonly azd: IAzdService,
        @inject(IContainerAppsClientProvider) private readonly createClient: IContainerAppsClientProvider,
        @inject(ILogsQueryClientProvider) private readonly createLogsClient: ILogsQueryClientProvider,
        @inject(ISubscriptionResolver) private readonly resolveSubscription: ISubscriptionResolver,
    ) {
        super();
    }

    public override shouldExecute(context: Readonly<CreateContainerAppContext>): boolean {
        return context.provision === true;
    }

    public async execute(context: Readonly<CreateContainerAppContext>): Promise<void> {
        try {
            await this.verify(context);
        } catch (error) {
            // Verification is a diagnostic, not part of the deployment. If it
            // cannot run, say so quietly rather than failing a wizard whose
            // resources were provisioned successfully.
            this.output.debug(`[containerApps] start verification did not run: ${stringifyError(error)}`);
        }
    }

    private async verify(context: Readonly<CreateContainerAppContext>): Promise<void> {
        const subscription = context.subscription
            ?? (context.hydratedSubscriptionId ? await this.resolveSubscription(context.hydratedSubscriptionId) : undefined);

        if (!subscription || !context.iacFolder || !context.environmentName) {
            return;
        }

        // The consumer template publishes the app's name and resource group as
        // azd outputs, which is how the wizard learns what provisioning created
        // without having to guess at the naming scheme inside the module.
        const values = await this.azd.envGetValues(context.environmentName, context.iacFolder);
        const appName = values.AZURE_CONTAINER_APP_NAME;
        const resourceGroupName = values.AZURE_RESOURCE_GROUP;

        if (!appName || !resourceGroupName) {
            return;
        }

        const client = this.createClient(subscription);
        const state = await this.pollUntilSettled(subscription, resourceGroupName, appName);

        if (state && HealthyStates.has(state)) {
            this.output.debug(`[containerApps] '${appName}' started (${state})`);
            return;
        }

        this.output.warn(`[containerApps] '${appName}' did not start cleanly (state: ${state ?? 'unknown'})`);

        const app = await client.containerApps.get(resourceGroupName, appName);
        const logs = await this.readConsoleLogs(subscription, app.environmentId, appName);

        if (logs.length > 0) {
            this.output.warn(this.code.l10n.t('Console logs for \'{0}\':', appName));
            for (const line of logs) {
                this.output.warn(line);
            }
        }

        void showMessage(
            this.code,
            this.code.l10n.t('\'{0}\' was created but has not started successfully. See the output for details.', appName),
            { severity: 'warning' },
        );
    }

    /**
     * Polls the app's latest revision until it leaves a transient state.
     *
     * @returns The settled running state, or `undefined` if it never settled.
     */
    private async pollUntilSettled(
        subscription: AzureSubscription,
        resourceGroupName: string,
        appName: string,
    ): Promise<string | undefined> {
        const client = this.createClient(subscription);
        const deadline = Date.now() + SettleTimeoutMs;

        while (Date.now() < deadline) {
            const app = await client.containerApps.get(resourceGroupName, appName);
            const revisionName = app.latestRevisionName;

            if (revisionName) {
                const revision = await client.containerAppsRevisions.getRevision(resourceGroupName, appName, revisionName);
                const state = revision.runningState?.toLowerCase();

                if (state && !TransientStates.has(state)) {
                    return state;
                }
            }

            await delay(PollIntervalMs);
        }

        return undefined;
    }

    /** Reads the app's recent console logs from its environment's workspace. */
    private async readConsoleLogs(
        subscription: AzureSubscription,
        environmentId: string | undefined,
        appName: string,
    ): Promise<readonly string[]> {
        if (!environmentId) {
            return [];
        }

        const client = this.createClient(subscription);
        const parsed = parseAzureResourceId(environmentId);
        if (!parsed.resourceGroup || !parsed.resourceName) {
            return [];
        }

        const environment = await client.managedEnvironments.get(parsed.resourceGroup, parsed.resourceName);

        // The query API addresses a workspace by its customer id (a GUID), not
        // by its ARM resource id.
        const workspaceId = environment.appLogsConfiguration?.logAnalyticsConfiguration?.customerId;
        if (!workspaceId) {
            return [];
        }

        const logsClient = this.createLogsClient(subscription);

        return logsClient.queryWorkspace(
            workspaceId,
            `ContainerAppConsoleLogs_CL
                | where ContainerAppName_s == '${appName}'
                | project TimeGenerated, Log_s
                | order by TimeGenerated desc
                | take ${MaxLogLines}`,
            LogWindowMinutes,
        );
    }
}
