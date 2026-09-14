/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHttpPoller, type OperationResponse, type OperationState } from '@azure/core-lro';
import {
    IContainerAppsClientProvider,
    type AzureSubscription, type IContainerAppsClient, type Revision,
} from '@microsoft/vscode-azure-azutils';
import { CancellationError, IActionContext, IVsCode, toAbortSignal, withCancellation } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import { ICodeDeploymentDataProvider, type CodeDeploymentHandle } from '../../tree/activity/CodeDeploymentDataProvider';
import type { ManagedCommand } from '../ManagedCommand';
import { StartStreamingLogs, type StartStreamingLogsRequest } from './StartStreamingLogs';

/** Resolved deployment target, independent of the originating wizard's lifetime. */
export interface VerifyContainerAppStartRequest {
    readonly subscription: AzureSubscription;
    readonly resourceGroupName: string;
    readonly appName: string;
}

interface ResolvedStartTarget extends VerifyContainerAppStartRequest {
    readonly revisionName: string;
}

const SettleTimeoutMs = 120_000;
const PollIntervalMs = 5_000;

/**
 * Verifies one captured revision in a separate root activity.
 *
 * Captures ARM's latest revision once; this is not proof of image/deployment correlation.
 * An optional caller-owned token cancels verification; the activity tree has no Cancel action.
 * Failures offer explicit app and system stream actions without reading customer logs.
 */
@injectable()
export class VerifyContainerAppStart implements ManagedCommand {
    public static readonly CommandId = 'vscode-azure/containerApps/verifyStart';

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IActionContext) private readonly actionContext: IActionContext,
        @inject(IContainerAppsClientProvider) private readonly createClient: IContainerAppsClientProvider,
        @inject(ICodeDeploymentDataProvider) private readonly activities: ICodeDeploymentDataProvider,
    ) { }

    /** Completes its activity before propagating a sanitized failure to managed-command handling. */
    public async execute(request: VerifyContainerAppStartRequest, cancellation?: vscode.CancellationToken): Promise<void> {
        this.actionContext.telemetry.isUserEvent = false;
        this.actionContext.errorHandling.suppress = 'display';
        const activity = this.activities.trackDeployment({ title: this.code.l10n.t('Verify Container App startup') });
        const bridge = toAbortSignal(cancellation);
        const timeout = AbortSignal.timeout(SettleTimeoutMs);
        const abortSignal = bridge.signal ? AbortSignal.any([bridge.signal, timeout]) : timeout;
        let failure: string | undefined;
        let resolvedTarget: ResolvedStartTarget | undefined;
        try {
            abortSignal.throwIfAborted();
            const client = this.createClient(request.subscription);
            resolvedTarget = await this.resolveTarget(client, request, abortSignal);
            if (!resolvedTarget) {
                failure = this.code.l10n.t('The deployed Container App has no latest revision to verify.');
            } else {
                activity.addChild({
                    title: this.code.l10n.t('Checking revision {0} of {1}', resolvedTarget.revisionName, resolvedTarget.appName),
                    status: 'Info', isLeaf: true,
                });
                failure = await this.waitForStartup(client, resolvedTarget, abortSignal);
            }
        } catch {
            if (cancellation?.isCancellationRequested) {
                activity.complete('Canceled');
                throw new CancellationError();
            }
            failure ??= timeout.aborted
                ? this.code.l10n.t('Container App startup verification timed out after two minutes.')
                : this.code.l10n.t('Unable to verify Container App startup. Check access to the app and revision.');
        } finally {
            bridge.disposable.dispose();
        }
        activity.complete(failure ? 'Failed' : 'Completed', failure);
        if (failure) {
            this.addLogShortcuts(activity, request, resolvedTarget?.revisionName);
            throw new Error(failure);
        }
    }

    /** Captures the latest revision once; an absent revision is reported by the caller. */
    private async resolveTarget(
        client: IContainerAppsClient, request: VerifyContainerAppStartRequest, abortSignal: AbortSignal,
    ): Promise<ResolvedStartTarget | undefined> {
        const app = await withCancellation(
            () => client.containerApps.get(request.resourceGroupName, request.appName, { abortSignal }),
            abortSignal,
        );
        abortSignal.throwIfAborted();
        return app.latestRevisionName
            ? { ...request, revisionName: app.latestRevisionName }
            : undefined;
    }

    /** Returns a user-facing failure for an unhealthy revision, or undefined when healthy. */
    private async waitForStartup(
        client: IContainerAppsClient, target: ResolvedStartTarget, abortSignal: AbortSignal,
    ): Promise<string | undefined> {
        const checkRevision = () => this.checkRevision(client, target, abortSignal);
        const poller = createHttpPoller<Revision, OperationState<Revision>>(
            { sendInitialRequest: checkRevision, sendPollRequest: checkRevision },
            { intervalInMs: PollIntervalMs, resolveOnUnsuccessful: true },
        );
        const revision = await withCancellation(() => poller.pollUntilDone({ abortSignal }), abortSignal);
        if (poller.operationState?.status === 'failed') {
            return this.code.l10n.t(
                'Revision {0} did not start successfully (provisioning: {1}; running: {2}).',
                target.revisionName, revision.provisioningState ?? this.code.l10n.t('unknown'),
                revision.runningState ?? this.code.l10n.t('unknown'),
            );
        }
        return undefined;
    }

    private async checkRevision(
        client: IContainerAppsClient, target: ResolvedStartTarget, abortSignal: AbortSignal,
    ): Promise<OperationResponse<Revision>> {
        const revision = await client.containerAppsRevisions.getRevision(
            target.resourceGroupName, target.appName, target.revisionName, { abortSignal },
        );
        abortSignal.throwIfAborted();
        const provisioning = revision.provisioningState?.toLowerCase();
        const running = revision.runningState?.toLowerCase();
        const failed = ['failed', 'deprovisioned'].includes(provisioning ?? '')
            || ['failed', 'degraded', 'stopped'].includes(running ?? '');
        const healthy = provisioning === 'provisioned' && ['running', 'scaledtozero'].includes(running ?? '');
        return {
            flatResponse: revision,
            // PUT selects core-lro's body-status protocol; requests remain revision GETs.
            rawResponse: {
                request: { method: 'PUT', url: revision.id }, statusCode: 200, headers: {},
                body: { provisioningState: failed ? 'Failed' : healthy ? 'Succeeded' : 'InProgress' },
            },
        };
    }

    private addLogShortcuts(activity: CodeDeploymentHandle, request: VerifyContainerAppStartRequest, revisionName?: string): void {
        const app = {
            id: `/subscriptions/${request.subscription.subscriptionId}/resourceGroups/${request.resourceGroupName}/providers/Microsoft.App/containerApps/${request.appName}`,
            name: request.appName,
            subscription: request.subscription,
        };
        const shortcuts: readonly { readonly title: string; readonly target: StartStreamingLogsRequest }[] = [
            { title: this.code.l10n.t('Open System Log Stream'), target: { kind: 'system', app } },
            { title: this.code.l10n.t('Open App Log Stream'), target: { kind: 'console', app, revisionName } },
        ];
        for (const { title, target } of shortcuts) {
            activity.addChild({
                title, status: 'Info', isLeaf: true,
                command: { title, command: StartStreamingLogs.CommandId, arguments: [target] satisfies Parameters<StartStreamingLogs['execute']> },
            });
        }
    }
}
