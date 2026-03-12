/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ServiceClient, ServiceClientOptions } from '@azure/core-client';
import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import { parseAzureResourceId } from '@microsoft/vscode-azure-azutils';
import { type DataProvider, type Disposable, EventEmitter, IActionExecutor, ICodeContext } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { type Activity, type ArmDeploymentActivity, type ArmDeploymentOperationActivity, isActivity } from './Activity';

let coreClient: typeof import('@azure/core-client') | undefined;
let coreRestPipeline: typeof import('@azure/core-rest-pipeline') | undefined;

const DefaultPollIntervalMs = 10_000;
const ArmApiVersion = '2024-07-01';
const ArmEndpoint = 'https://management.azure.com'; // TODO: get from settings / etc.

type ArmActivity = ArmDeploymentActivity | ArmDeploymentOperationActivity;

@injectable()
export class ArmDeploymentDataProvider implements DataProvider<ArmActivity>, Disposable {
    public readonly isRoot = true;

    private readonly deployments = new Map<string, ArmDeploymentActivity>();
    private readonly operations = new Map<string, ArmDeploymentOperationActivity[]>();
    private readonly pollingTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly clientCache = new Map<string, ServiceClient>();

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
        const parsed = parseAzureResourceId(deploymentId);
        if (!parsed.resourceGroup || !parsed.resourceName) {
            throw new Error(`Invalid ARM deployment ID: ${deploymentId}`);
        }

        const activity: ArmDeploymentActivity = {
            id: deploymentId,
            type: 'armDeployment',
            status: 'InProgress',
            title: parsed.resourceName,
            startTime: new Date(),
            deploymentId,
            subscription,
            resourceGroupName: parsed.resourceGroup,
            deploymentName: parsed.resourceName,
        };

        this.deployments.set(activity.id, activity);
        this.onDidChangeEmitter.fire();
        void this.poll(activity);
    }

    private async poll(activity: ArmDeploymentActivity): Promise<void> {
        let nextPollMs = DefaultPollIntervalMs;

        try {
            const client = await this.getOrCreateClient(activity.subscription);
            const baseUrl = `${ArmEndpoint}${activity.deploymentId}`;
            const pipeline = await this.ensureRestPipeline();

            // Get deployment status
            const deploymentResponse = await client.sendRequest(
                pipeline.createPipelineRequest({
                    method: 'GET',
                    url: `${baseUrl}?api-version=${ArmApiVersion}`,
                }),
            );

            const deploymentBody = JSON.parse(deploymentResponse.bodyAsText ?? '{}') as ArmDeploymentResponse;
            const provisioningState = deploymentBody.properties?.provisioningState;

            // Respect Retry-After header
            const retryAfter = deploymentResponse.headers.get('retry-after');
            if (retryAfter) {
                const retrySeconds = parseInt(retryAfter, 10);
                if (!isNaN(retrySeconds) && retrySeconds > 0) {
                    nextPollMs = retrySeconds * 1000;
                }
            }

            // List deployment operations
            const opsResponse = await client.sendRequest(
                pipeline.createPipelineRequest({
                    method: 'GET',
                    url: `${baseUrl}/operations?api-version=${ArmApiVersion}`,
                }),
            );

            const opsBody = JSON.parse(opsResponse.bodyAsText ?? '{}') as ArmDeploymentOperationsResponse;
            const ops = (opsBody.value ?? [])
                .map(op => this.toOperationActivity(op, activity))
                .filter((op): op is ArmDeploymentOperationActivity => op !== undefined);
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

        const timer = setTimeout(() => void this.poll(activity), nextPollMs);
        this.pollingTimers.set(activity.id, timer);
    }

    private toOperationActivity(op: ArmDeploymentOperationValue, parent: ArmDeploymentActivity): ArmDeploymentOperationActivity | undefined {
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

    private async getOrCreateClient(subscription: AzureSubscription): Promise<ServiceClient> {
        let client = this.clientCache.get(subscription.subscriptionId);
        if (!client) {
            coreClient ??= await import('@azure/core-client');
            const pipeline = await this.ensureRestPipeline();

            const options: ServiceClientOptions = {
                additionalPolicies: [
                    {
                        policy: pipeline.bearerTokenAuthenticationPolicy({
                            credential: subscription.credential,
                            scopes: [`${ArmEndpoint}/.default`],
                        }),
                        position: 'perCall',
                    },
                ],
            };
            client = new coreClient.ServiceClient(options);
            this.clientCache.set(subscription.subscriptionId, client);
        }
        return client;
    }

    private async ensureRestPipeline(): Promise<typeof import('@azure/core-rest-pipeline')> {
        coreRestPipeline ??= await import('@azure/core-rest-pipeline');
        return coreRestPipeline;
    }

    public dispose(): void {
        for (const timer of this.pollingTimers.values()) {
            clearTimeout(timer);
        }
        this.pollingTimers.clear();
        this.onDidChangeEmitter.dispose();
    }
}

// #region ARM REST response types

interface ArmDeploymentResponse {
    readonly properties?: {
        readonly provisioningState?: string;
    };
}

interface ArmDeploymentOperationsResponse {
    readonly value?: readonly ArmDeploymentOperationValue[];
}

interface ArmDeploymentOperationValue {
    readonly operationId?: string;
    readonly properties?: {
        readonly provisioningState?: string;
        readonly targetResource?: {
            readonly resourceType?: string;
            readonly resourceName?: string;
        };
    };
}

// #endregion

function toActivityStatus(provisioningState: string | undefined): Activity['status'] {
    switch (provisioningState?.toLowerCase()) {
        case 'succeeded':
            return 'Completed';
        case 'failed':
        case 'canceled':
            return 'Failed';
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
