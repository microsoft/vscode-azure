/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    DeploymentOperationsListAtScopeOptionalParams,
    DeploymentsClient,
    DeploymentsClientOptionalParams,
    DeploymentsGetAtScopeOptionalParams,
    DeploymentExtended as SdkDeploymentExtended,
    DeploymentOperation as SdkDeploymentOperation,
    ProvisioningOperation as SdkProvisioningOperation,
    ProvisioningState as SdkProvisioningState,
} from '@azure/arm-resourcesdeployments';
import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import type { AsyncFactory, IActionExecutor, ICodeContext, Page, WithRequired } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import { createAzureSubscriptionClient } from '../createAzureClient';
import { toPages } from '../toPages';

/**
 * Subset of {@linkcode SdkDeploymentExtended} with fields that the ARM API always returns.
 */
export type DeploymentExtended = WithRequired<SdkDeploymentExtended, 'id' | 'name' | 'type'>;
export type DeploymentOperation = SdkDeploymentOperation;
export type ProvisioningOperation = SdkProvisioningOperation;
export type ProvisioningState = SdkProvisioningState;

/** Factory that creates an {@linkcode IDeploymentClient} for a given subscription. */
export const IDeploymentClientProvider: ServiceIdentifier<IDeploymentClientProvider> = Symbol.for('IDeploymentClientProvider');
export type IDeploymentClientProvider = AsyncFactory<IDeploymentClient, [AzureSubscription]>;

/**
 * Interface describing the deployment APIs we use.
 * Designed so that tests can provide a mock implementation directly.
 */
export interface IDeploymentClient {
    readonly deployments: {
        getAtScope(scope: string, deploymentName: string, options?: DeploymentsGetAtScopeOptionalParams): Promise<DeploymentExtended>;
    };
    readonly deploymentOperations: {
        listAtScope(scope: string, deploymentName: string, options?: DeploymentOperationsListAtScopeOptionalParams): AsyncIterable<Page<SdkDeploymentOperation>>;
    };
}

/**
 * Wrapper around {@linkcode DeploymentsClient} that exposes only the methods
 * we use, with corrected return types.
 *
 * Use the static {@linkcode create} factory to construct--it lazily imports
 * the SDK to keep load times down.
 */
export class DeploymentClient implements IDeploymentClient {
    private static sdk: typeof import('@azure/arm-resourcesdeployments') | undefined;

    private constructor(private readonly inner: DeploymentsClient) { }

    /**
     * Create a new {@linkcode DeploymentClient} instance. Lazily imports
     * `@azure/arm-resourcesdeployments` on first call.
     */
    public static async create(
        ctx: ICodeContext,
        executor: IActionExecutor,
        subscription: AzureSubscription,
        options?: DeploymentsClientOptionalParams,
    ): Promise<DeploymentClient> {
        DeploymentClient.sdk ??= await import('@azure/arm-resourcesdeployments');
        const client = createAzureSubscriptionClient(
            ctx,
            executor,
            DeploymentClient.sdk.DeploymentsClient,
            subscription,
            options,
        );
        return new DeploymentClient(client);
    }

    public get deployments(): IDeploymentClient['deployments'] {
        return this.inner.deployments as IDeploymentClient['deployments'];
    }

    public get deploymentOperations(): IDeploymentClient['deploymentOperations'] {
        return { listAtScope: (scope, deploymentName, options) => this.listOperationsAtScope(scope, deploymentName, options) };
    }

    private listOperationsAtScope(scope: string, deploymentName: string, options?: DeploymentOperationsListAtScopeOptionalParams): AsyncIterable<Page<SdkDeploymentOperation>> {
        return toPages(
            this.inner.deploymentOperations.listAtScope(scope, deploymentName, options),
            DeploymentClient.sdk!.getContinuationToken, // eslint-disable-line @typescript-eslint/no-non-null-assertion -- SDK is imported during client creation
        );
    }
}
