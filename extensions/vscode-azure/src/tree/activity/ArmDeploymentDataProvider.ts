/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DeploymentOperation, DeploymentsClient, ProvisioningOperation, ProvisioningState } from '@azure/arm-resourcesdeployments';
import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import { createAzureSubscriptionClient } from '@microsoft/vscode-azure-azutils';
import { type DataProvider, type Disposable, EventEmitter, IActionExecutor, ICodeContext } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { type Activity, type ActivityChangeEvent, type ArmDeploymentActivity, type ArmDeploymentOperationActivity, isActivity } from './Activity';

let armResourcesDeployments: typeof import('@azure/arm-resourcesdeployments') | undefined;

const DefaultPollIntervalMs = 10_000;
export const DeploymentResourceType = 'Microsoft.Resources/deployments';

/**
 * AVM (Azure Verified Modules) telemetry deployments use this name prefix.
 * These are empty deployments with no resources, used only for module usage
 * tracking. See https://aka.ms/avm/TelemetryInfo
 */
const AvmTelemetryPrefix = '46d3x';

/**
 * Determines whether an operation should be shown in the activity tree.
 * Used by both the data provider (to decide whether to poll a nested
 * deployment) and the view provider (to filter visible leaf operations).
 */
export function isVisibleOperation(op: ArmDeploymentOperationActivity): boolean {
    // Hide AVM telemetry deployments
    if (op.targetResourceType?.toLowerCase() === DeploymentResourceType.toLowerCase()
        && op.targetResourceName?.startsWith(AvmTelemetryPrefix)) {
        return false;
    }
    return true;
}

@injectable()
export class ArmDeploymentDataProvider implements DataProvider<ArmDeploymentActivity>, Disposable {
    public readonly isRoot = true;

    /** Top-level tracked deployments (user-initiated). */
    private readonly trackedRoots = new Map<string, ArmDeploymentActivity>();
    private readonly pollingTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly clientCache = new Map<string, DeploymentsClient>();

    private readonly onDidChangeEmitter = new EventEmitter<ActivityChangeEvent>();
    public readonly onDidChange = this.onDidChangeEmitter.event;

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
    ) { }

    public canHandle(resource: unknown): resource is ArmDeploymentActivity {
        return isActivity(resource) && resource.type === 'armDeployment';
    }

    /**
     * Returns child **deployments** only. Leaf operations are stored on
     * the deployment via {@link enrich} and injected by the view provider.
     */
    public getChildren(resource?: ArmDeploymentActivity): ArmDeploymentActivity[] {
        if (!resource) {
            return [...this.trackedRoots.values()];
        }

        // Child deployments are extracted from the operations list.
        // If enrichment hasn't run yet, operations will be undefined.
        return this.extractChildDeployments(resource);
    }

    /**
     * Fetch all operations for the deployment and store them in-place.
     * Starts polling for non-terminal deployments. Called automatically
     * by {@link DataItemTree} after a resource is loaded.
     */
    public async enrich(resource: ArmDeploymentActivity): Promise<void> {
        const client = await this.getOrCreateClient(resource.subscription);
        resource.operations = await this.fetchOperations(client, resource);

        // Start polling if not terminal and not already polling
        if (!isTerminalState(resource.status) && !this.pollingTimers.has(resource.id)) {
            void this.poll(resource);
        }
    }

    public trackDeployment(deploymentId: string, subscription: AzureSubscription): void {
        const { scope, deploymentName } = parseDeploymentId(deploymentId);

        const activity: ArmDeploymentActivity = {
            id: deploymentId,
            type: 'armDeployment',
            status: 'InProgress',
            title: deploymentName,
            startTime: new Date(),
            deploymentId,
            subscription,
            scope,
            deploymentName,
        };

        this.trackedRoots.set(activity.id, activity);
        this.onDidChangeEmitter.fire({ childrenChanged: true });
    }

    /**
     * Poll a deployment's status and refresh its operations. Fires targeted
     * change events based on whether the operation count changed.
     */
    private async poll(activity: ArmDeploymentActivity): Promise<void> {
        let nextPollMs = DefaultPollIntervalMs;

        try {
            const client = await this.getOrCreateClient(activity.subscription);

            let retryAfterSeconds: number | undefined;
            const deployment = await client.deployments.getAtScope(
                activity.scope,
                activity.deploymentName,
                {
                    onResponse: (response) => {
                        const header = response.headers.get('retry-after');
                        if (header) {
                            const parsed = parseInt(header, 10);
                            if (!isNaN(parsed) && parsed > 0) {
                                retryAfterSeconds = parsed;
                            }
                        }
                    },
                },
            );

            if (retryAfterSeconds) {
                nextPollMs = retryAfterSeconds * 1000;
            }

            const provisioningState = deployment.properties?.provisioningState;
            if (provisioningState) {
                activity.status = toActivityStatus(provisioningState);
                activity.description = provisioningState;
            }

            // Refresh operations and detect structural changes
            const prevCount = activity.operations?.length ?? 0;
            activity.operations = await this.fetchOperations(client, activity);
            const childrenChanged = activity.operations.length !== prevCount;

            if (isTerminalState(provisioningState)) {
                activity.endTime = new Date();
                this.pollingTimers.delete(activity.id);
                this.onDidChangeEmitter.fire({ activity, childrenChanged });
                return;
            }

            this.onDidChangeEmitter.fire({ activity, childrenChanged });
        } catch {
            // Continue polling on transient errors
        }

        // TODO: is this timer cleared?
        const timer = setTimeout(() => void this.poll(activity), nextPollMs);
        this.pollingTimers.set(activity.id, timer);
    }

    /**
     * Extract child deployments from a deployment's operations.
     */
    private extractChildDeployments(activity: ArmDeploymentActivity): ArmDeploymentActivity[] {
        if (!activity.operations) {
            return [];
        }

        const results: ArmDeploymentActivity[] = [];
        for (const op of activity.operations) {
            if (op.targetResourceType?.toLowerCase() !== DeploymentResourceType.toLowerCase()
                || !op.targetResourceId
                || !isVisibleOperation(op)) {
                continue;
            }

            try {
                const { scope, deploymentName } = parseDeploymentId(op.targetResourceId);
                results.push({
                    id: op.targetResourceId,
                    type: 'armDeployment',
                    status: op.status,
                    title: op.targetResourceName ?? deploymentName,
                    description: op.provisioningState,
                    startTime: activity.startTime,
                    parentId: activity.id,
                    deploymentId: op.targetResourceId,
                    subscription: activity.subscription,
                    scope,
                    deploymentName,
                });
            } catch {
                // Skip if we can't parse the deployment ID
            }
        }
        return results;
    }

    /**
     * Fetch all operations for a deployment from the ARM API.
     * Deduplicates by target resource ID, keeping the most meaningful
     * operation per resource (Create/Delete over read-only ops).
     */
    private async fetchOperations(client: DeploymentsClient, activity: ArmDeploymentActivity): Promise<ArmDeploymentOperationActivity[]> {
        const byTargetId = new Map<string, { op: DeploymentOperation; rank: number }>();

        for await (const op of client.deploymentOperations.listAtScope(activity.scope, activity.deploymentName)) {
            const targetResource = op.properties?.targetResource;
            if (!op.operationId || !targetResource?.id) {
                continue;
            }

            const rank = operationRank(op.properties?.provisioningOperation);
            const existing = byTargetId.get(targetResource.id);
            if (!existing || rank > existing.rank) {
                byTargetId.set(targetResource.id, { op, rank });
            }
        }

        const results: ArmDeploymentOperationActivity[] = [];
        for (const { op } of byTargetId.values()) {
            const targetResource = op.properties?.targetResource;
            const provisioningState = op.properties?.provisioningState;
            const operationId = op.operationId ?? targetResource?.id ?? '';

            results.push({
                id: `${activity.id}/operations/${operationId}`,
                type: 'armDeploymentOperation',
                status: toActivityStatus(provisioningState),
                title: targetResource?.resourceName ?? operationId,
                description: targetResource?.resourceType,
                startTime: activity.startTime,
                parentId: activity.id,
                operationId,
                targetResourceId: targetResource?.id ?? '',
                targetResourceType: targetResource?.resourceType,
                targetResourceName: targetResource?.resourceName,
                provisioningState: provisioningState ?? undefined,
            });
        }

        return results;
    }

    private async getOrCreateClient(subscription: AzureSubscription): Promise<DeploymentsClient> {
        let client = this.clientCache.get(subscription.subscriptionId);
        if (!client) {
            armResourcesDeployments ??= await import('@azure/arm-resourcesdeployments');
            client = createAzureSubscriptionClient(
                this.ctx, this.executor,
                armResourcesDeployments.DeploymentsClient,
                subscription.credential, subscription.subscriptionId,
            );
            this.clientCache.set(subscription.subscriptionId, client);
        }
        return client;
    }

    public clearActivities(filter: (activity: ArmDeploymentActivity) => boolean): void {
        let changed = false;
        for (const [id, activity] of this.trackedRoots) {
            if (filter(activity)) {
                this.trackedRoots.delete(id);
                this.stopPolling(id);
                changed = true;
            }
        }
        if (changed) {
            this.onDidChangeEmitter.fire({ childrenChanged: true });
        }
    }

    public dispose(): void {
        for (const timer of this.pollingTimers.values()) {
            clearTimeout(timer);
        }
        this.pollingTimers.clear();
        this.onDidChangeEmitter.dispose();
    }

    private stopPolling(id: string): void {
        const timer = this.pollingTimers.get(id);
        if (timer) {
            clearTimeout(timer);
            this.pollingTimers.delete(id);
        }
    }
}

function toActivityStatus(provisioningState: ProvisioningState | undefined): Activity['status'] {
    switch (provisioningState?.toLowerCase()) {
        case 'succeeded':
            return 'Completed';
        case 'failed':
            return 'Failed';
        case 'canceled':
            return 'Canceled';
        case 'running':
        case 'accepted':
        case 'creating':
        case 'created':
        case 'deleting':
        case 'updating':
            return 'InProgress';
        default:
            return 'NotStarted';
    }
}

function isTerminalState(provisioningState: ProvisioningState | undefined): boolean {
    const lower = provisioningState?.toLowerCase();
    return lower === 'succeeded' || lower === 'failed' || lower === 'canceled';
}

/**
 * Assigns a priority rank to a provisioning operation type.
 * Higher rank = more meaningful operation when deduplicating by target resource.
 * `Create` and `Delete` are the most interesting; read-only and internal
 * operations (e.g. `EvaluateDeploymentOutput`, `Waiting`) rank lowest.
 */
function operationRank(provisioningOperation: ProvisioningOperation | undefined): number {
    switch (provisioningOperation) {
        case 'Create':
        case 'Delete':
            return 3;
        case 'Action':
            return 2;
        case 'Read':
            return 1;
        default:
            return 0;
    }
}

const deploymentsSegment = `/providers/${DeploymentResourceType.toLowerCase()}/`;

/**
 * Parses an ARM deployment resource ID into its scope and deployment name.
 *
 * Works for any deployment scope:
 * - Resource group: `/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Resources/deployments/{name}`
 * - Subscription: `/subscriptions/{sub}/providers/Microsoft.Resources/deployments/{name}`
 * - Management group: `/providers/Microsoft.Management/managementGroups/{mg}/providers/Microsoft.Resources/deployments/{name}`
 * - Tenant: `/providers/Microsoft.Resources/deployments/{name}`
 *
 * @returns The ARM scope prefix and the deployment name.
 * @throws if the ID does not contain a `Microsoft.Resources/deployments` segment.
 */
export function parseDeploymentId(deploymentId: string): { scope: string; deploymentName: string } {
    const idx = deploymentId.toLowerCase().indexOf(deploymentsSegment);
    if (idx === -1) {
        throw new Error(`Not an ARM deployment resource ID: ${deploymentId}`);
    }

    const scope = deploymentId.substring(0, idx);
    const deploymentName = deploymentId.substring(idx + deploymentsSegment.length);

    if (!deploymentName) {
        throw new Error(`ARM deployment resource ID is missing a deployment name: ${deploymentId}`);
    }

    return { scope, deploymentName };
}
