/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDeployments, type DeploymentsClientOptionalParams, type DeploymentsContext } from '@azure/arm-resourcesdeployments/api';
import { listAtScope as sdkListAtScope, type DeploymentOperationsListAtScopeOptionalParams } from '@azure/arm-resourcesdeployments/api/deploymentOperations';
import { getAtScope as sdkGetAtScope, type DeploymentsGetAtScopeOptionalParams } from '@azure/arm-resourcesdeployments/api/deployments';
import {
    KnownProvisioningState as SdkKnownProvisioningState,
    type DeploymentExtended as SdkDeploymentExtended,
    type DeploymentOperation as SdkDeploymentOperation,
    type ProvisioningOperation as SdkProvisioningOperation,
    type ProvisioningState as SdkProvisioningState,
} from '@azure/arm-resourcesdeployments/models';
import type { TokenCredential } from '@azure/core-auth';
import type { IActionExecutor, ICodeContext, Page, SyncFactory, WithRequired } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import type { AzureSubscription } from '../../auth/AzureSubscription';
import { createArmRestSubscriptionClient } from '../createAzureClient';
import { toPages } from '../toPages';

/**
 * Subset of {@linkcode SdkDeploymentExtended} with fields that the ARM API always returns.
 */
export type DeploymentExtended = WithRequired<SdkDeploymentExtended, 'id' | 'name' | 'type'>;
export type DeploymentOperation = SdkDeploymentOperation;
export type ProvisioningOperation = SdkProvisioningOperation;
export type ProvisioningState = SdkProvisioningState;
export { SdkKnownProvisioningState as KnownProvisioningState };

/** Factory that creates an {@linkcode IDeploymentClient} for a given subscription. */
export const IDeploymentClientProvider: ServiceIdentifier<IDeploymentClientProvider> = Symbol.for('IDeploymentClientProvider');
export type IDeploymentClientProvider = SyncFactory<IDeploymentClient, [AzureSubscription]>;

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
 * Wrapper around the `@azure/arm-resourcesdeployments` REST-style SDK that
 * adapts free functions into the `client.deployments.*` / `client.deploymentOperations.*`
 * pattern.
 *
 * Use the static {@linkcode create} factory to construct.
 */
export class DeploymentClient implements IDeploymentClient {
    private constructor(private readonly inner: DeploymentsContext) { }

    /**
     * Create a new {@linkcode DeploymentClient} instance.
     */
    public static create(
        ctx: ICodeContext,
        executor: IActionExecutor,
        credential: TokenCredential,
        subscription: AzureSubscription,
        options?: DeploymentsClientOptionalParams,
    ): DeploymentClient {
        const context = createArmRestSubscriptionClient(
            ctx,
            executor,
            createDeployments,
            credential,
            subscription,
            options,
        );
        return new DeploymentClient(context);
    }

    public get deployments(): IDeploymentClient['deployments'] {
        return { getAtScope: (scope, deploymentName, options) => sdkGetAtScope(this.inner, scope, deploymentName, options) as Promise<DeploymentExtended> };
    }

    public get deploymentOperations(): IDeploymentClient['deploymentOperations'] {
        return { listAtScope: (scope, deploymentName, options) => this.listOperationsAtScope(scope, deploymentName, options) };
    }

    private listOperationsAtScope(scope: string, deploymentName: string, options?: DeploymentOperationsListAtScopeOptionalParams): AsyncIterable<Page<SdkDeploymentOperation>> {
        return toPages(sdkListAtScope(this.inner, scope, deploymentName, options));
    }
}
