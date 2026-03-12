/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DeploymentsClient } from '@azure/arm-resourcesdeployments';
import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import { createAzureSubscriptionClient } from '@microsoft/vscode-azure-azutils';
import { type DataProvider, type Disposable, EventEmitter, IActionExecutor, ICodeContext } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { type Activity, type ArmDeploymentActivity, type ArmDeploymentOperationActivity, isActivity } from './Activity';

let armResourcesDeployments: typeof import('@azure/arm-resourcesdeployments') | undefined;

const DefaultPollIntervalMs = 10_000;

type ArmActivity = ArmDeploymentActivity | ArmDeploymentOperationActivity;

const DeploymentResourceType = 'Microsoft.Resources/deployments';

@injectable()
export class ArmDeploymentDataProvider implements DataProvider<ArmActivity>, Disposable {
    public readonly isRoot = true;

    /** Top-level tracked deployments (user-initiated). */
    private readonly trackedRoots = new Map<string, ArmDeploymentActivity>();
    private readonly pollingTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly clientCache = new Map<string, DeploymentsClient>();

    private readonly onDidChangeEmitter = new EventEmitter<void>();
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
            return this.fetchOperations(resource as ArmDeploymentActivity);
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
        this.onDidChangeEmitter.fire();
        void this.poll(activity);
    }

    /**
     * Polling only checks the root deployment's status and fires
     * change events. The tree re-fetches children via {@link getChildren}.
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

            if (isTerminalState(provisioningState)) {
                activity.endTime = new Date();
                this.pollingTimers.delete(activity.id);
                this.onDidChangeEmitter.fire();
                return;
            }
        } catch {
            // Continue polling on transient errors
        }

        this.onDidChangeEmitter.fire();

        const timer = setTimeout(() => void this.poll(activity), DefaultPollIntervalMs);
        this.pollingTimers.set(activity.id, timer);
    }

    /**
     * Fetch operations for a deployment from the ARM API.
     * Operations that target `Microsoft.Resources/deployments` are
     * returned as {@link ArmDeploymentActivity} nodes (collapsible);
     * all others are returned as leaf {@link ArmDeploymentOperationActivity} nodes.
     */
    private async fetchOperations(activity: ArmDeploymentActivity): Promise<ArmActivity[]> {
        const client = await this.getOrCreateClient(activity.subscription);
        const results: ArmActivity[] = [];

        for await (const op of client.deploymentOperations.listAtScope(activity.scope, activity.deploymentName)) {
            if (!op.operationId) {
                continue;
            }

            const targetResource = op.properties?.targetResource;
            const provisioningState = op.properties?.provisioningState;

            if (targetResource?.resourceType?.toLowerCase() === DeploymentResourceType.toLowerCase() && targetResource.id) {
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
                    id: `${activity.id}/operations/${op.operationId}`,
                    type: 'armDeploymentOperation',
                    status: toActivityStatus(provisioningState),
                    title: targetResource?.resourceName ?? op.operationId,
                    description: targetResource?.resourceType,
                    startTime: activity.startTime,
                    parentId: activity.id,
                    operationId: op.operationId,
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

function toActivityStatus(provisioningState: string | undefined): Activity['status'] {
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

function isTerminalState(provisioningState: string | undefined): boolean {
    const lower = provisioningState?.toLowerCase();
    return lower === 'succeeded' || lower === 'failed' || lower === 'canceled';
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
