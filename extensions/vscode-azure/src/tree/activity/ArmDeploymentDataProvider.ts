/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DeploymentOperation, DeploymentsClient } from '@azure/arm-resourcesdeployments';
import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import { createAzureSubscriptionClient } from '@microsoft/vscode-azure-azutils';
import { type DataProvider, type Disposable, EventEmitter, IActionExecutor, ICodeContext } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { type Activity, type ArmDeploymentActivity, type ArmDeploymentOperationActivity, isActivity } from './Activity';

let armResourcesDeployments: typeof import('@azure/arm-resourcesdeployments') | undefined;

const DefaultPollIntervalMs = 10_000;

type ArmActivity = ArmDeploymentActivity | ArmDeploymentOperationActivity;

@injectable()
export class ArmDeploymentDataProvider implements DataProvider<ArmActivity>, Disposable {
    public readonly isRoot = true;

    private readonly deployments = new Map<string, ArmDeploymentActivity>();
    private readonly operations = new Map<string, ArmDeploymentOperationActivity[]>();
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

    public getChildren(resource?: Activity): Promise<ArmActivity[]> {
        if (!resource) {
            return Promise.resolve([...this.deployments.values()]);
        }

        if (resource.type === 'armDeployment') {
            return Promise.resolve(this.operations.get(resource.id) ?? []);
        }

        return Promise.resolve([]);
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

        this.deployments.set(activity.id, activity);
        this.onDidChangeEmitter.fire();
        void this.poll(activity);
    }

    private async poll(activity: ArmDeploymentActivity): Promise<void> {
        try {
            const client = await this.getOrCreateClient(activity.subscription);

            // Get deployment status
            const deployment = await client.deployments.getAtScope(
                activity.scope,
                activity.deploymentName,
            );
            const provisioningState = deployment.properties?.provisioningState;

            // Fetch deployment operations
            const ops: ArmDeploymentOperationActivity[] = [];
            for await (const op of client.deploymentOperations.listAtScope(activity.scope, activity.deploymentName)) {
                const opActivity = this.toOperationActivity(op, activity);
                if (opActivity) {
                    ops.push(opActivity);
                }
            }
            this.operations.set(activity.id, ops);

            // Update deployment status
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

    private toOperationActivity(op: DeploymentOperation, parent: ArmDeploymentActivity): ArmDeploymentOperationActivity | undefined {
        if (!op.operationId) {
            return undefined;
        }

        const targetResource = op.properties?.targetResource;
        const provisioningState = op.properties?.provisioningState;

        return {
            id: `${parent.id}/operations/${op.operationId}`,
            type: 'armDeploymentOperation',
            status: toActivityStatus(provisioningState),
            title: targetResource?.resourceName ?? op.operationId,
            description: targetResource?.resourceType,
            startTime: parent.startTime,
            parentId: parent.id,
            operationId: op.operationId,
            targetResourceType: targetResource?.resourceType,
            targetResourceName: targetResource?.resourceName,
        };
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
