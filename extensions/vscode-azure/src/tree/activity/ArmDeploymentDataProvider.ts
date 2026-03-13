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

type ArmActivity = ArmDeploymentActivity | ArmDeploymentOperationActivity;

const DeploymentResourceType = 'Microsoft.Resources/deployments';

/**
 * AVM (Azure Verified Modules) telemetry deployments use this name prefix.
 * These are empty deployments with no resources, used only for module usage
 * tracking. See https://aka.ms/avm/TelemetryInfo
 */
const AvmTelemetryPrefix = '46d3x';

@injectable()
export class ArmDeploymentDataProvider implements DataProvider<ArmActivity>, Disposable {
    public readonly isRoot = true;

    /** Top-level tracked deployments (user-initiated). */
    private readonly trackedRoots = new Map<string, ArmDeploymentActivity>();
    /** Tracks the number of meaningful operations per deployment for change detection. */
    private readonly operationCounts = new Map<string, number>();
    private readonly pollingTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly clientCache = new Map<string, DeploymentsClient>();

    private readonly onDidChangeEmitter = new EventEmitter<ActivityChangeEvent>();
    public readonly onDidChange = this.onDidChangeEmitter.event;

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
    ) { }

    public canHandle(resource: unknown): resource is ArmActivity {
        return isActivity(resource)
            && (resource.type === 'armDeployment' || resource.type === 'armDeploymentOperation');
    }

    public async getChildren(resource?: Activity): Promise<ArmActivity[]> {
        if (!resource) {
            return [...this.trackedRoots.values()];
        }

        if (resource.type === 'armDeployment') {
            try {
                return await this.fetchOperations(resource as ArmDeploymentActivity);
            } catch {
                return [];
            }
        }

        return [];
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
        void this.poll(activity);
    }

    /**
     * Poll a root deployment's status and operation count. Fires targeted
     * change events:
     * - `childrenChanged: false` when only the deployment status changed
     * - `childrenChanged: true` when the operation count changed (new
     *   resources appeared or nested deployments were added)
     */
    private async poll(activity: ArmDeploymentActivity): Promise<void> {
        try {
            const client = await this.getOrCreateClient(activity.subscription);

            const deployment = await client.deployments.getAtScope(
                activity.scope,
                activity.deploymentName,
            );
            const provisioningState = deployment.properties?.provisioningState;

            if (provisioningState) {
                activity.status = toActivityStatus(provisioningState);
                activity.description = provisioningState;
            }

            // Count current operations to detect structural changes
            const opCount = await this.countOperations(client, activity);
            const prevCount = this.operationCounts.get(activity.id) ?? 0;
            const childrenChanged = opCount !== prevCount;
            this.operationCounts.set(activity.id, opCount);

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

        const timer = setTimeout(() => void this.poll(activity), DefaultPollIntervalMs);
        this.pollingTimers.set(activity.id, timer);
    }

    /**
     * Count meaningful operations for a deployment (excluding AVM telemetry
     * and operations without a target resource). Used to detect when the
     * operation list has structurally changed between polls.
     */
    private async countOperations(client: DeploymentsClient, activity: ArmDeploymentActivity): Promise<number> {
        let count = 0;
        for await (const op of client.deploymentOperations.listAtScope(activity.scope, activity.deploymentName)) {
            const targetResource = op.properties?.targetResource;
            if (!op.operationId || !targetResource?.id) {
                continue;
            }
            if (targetResource.resourceType?.toLowerCase() === DeploymentResourceType.toLowerCase()
                && targetResource.resourceName?.startsWith(AvmTelemetryPrefix)) {
                continue;
            }
            count++;
        }
        return count;
    }

    /**
     * Fetch operations for a deployment from the ARM API.
     *
     * Operations without a `targetResource` (e.g. `EvaluateDeploymentOutput`,
     * `Waiting`) are filtered out. When multiple operations target the same
     * resource, only one is kept (preferring `Create`/`Delete` over read-only ops).
     *
     * Operations that target `Microsoft.Resources/deployments` are
     * returned as {@link ArmDeploymentActivity} nodes (collapsible);
     * all others are returned as leaf {@link ArmDeploymentOperationActivity} nodes.
     */
    private async fetchOperations(activity: ArmDeploymentActivity): Promise<ArmActivity[]> {
        const client = await this.getOrCreateClient(activity.subscription);

        // Collect operations, deduplicating by target resource ID.
        // Keep the most meaningful operation per resource (Create/Delete > others).
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

        const results: ArmActivity[] = [];

        for (const { op } of byTargetId.values()) {
            const targetResource = op.properties?.targetResource;
            const provisioningState = op.properties?.provisioningState;
            const operationId = op.operationId ?? targetResource?.id ?? '';

            if (targetResource?.resourceType?.toLowerCase() === DeploymentResourceType.toLowerCase() && targetResource.id) {
                // Skip AVM telemetry deployments — empty deployments used
                // only for module usage tracking.
                if (targetResource.resourceName?.startsWith(AvmTelemetryPrefix)) {
                    continue;
                }

                // Nested deployment — return as a collapsible ArmDeploymentActivity
                const { scope, deploymentName } = parseDeploymentId(targetResource.id);
                results.push({
                    id: targetResource.id,
                    type: 'armDeployment',
                    status: toActivityStatus(provisioningState),
                    title: targetResource.resourceName ?? deploymentName,
                    description: provisioningState,
                    startTime: activity.startTime,
                    parentId: activity.id,
                    deploymentId: targetResource.id,
                    subscription: activity.subscription,
                    scope,
                    deploymentName,
                });
            } else {
                // Regular operation — return as a leaf node
                results.push({
                    id: `${activity.id}/operations/${operationId}`,
                    type: 'armDeploymentOperation',
                    status: toActivityStatus(provisioningState),
                    title: targetResource?.resourceName ?? operationId,
                    description: targetResource?.resourceType,
                    startTime: activity.startTime,
                    parentId: activity.id,
                    operationId,
                    targetResourceType: targetResource?.resourceType,
                    targetResourceName: targetResource?.resourceName,
                });
            }
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

    public dispose(): void {
        for (const timer of this.pollingTimers.values()) {
            clearTimeout(timer);
        }
        this.pollingTimers.clear();
        this.onDidChangeEmitter.dispose();
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

const deploymentsSegment = '/providers/microsoft.resources/deployments/';

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
