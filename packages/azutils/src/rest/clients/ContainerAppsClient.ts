/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ContainerAppsAPIClientOptionalParams, type ContainerAppsAPIContext, createContainerAppsAPI } from '@azure/arm-appcontainers/api';
import {
    getAuthToken as sdkGetAuthToken,
    get as sdkGetContainerApp,
    type ContainerAppsGetAuthTokenOptionalParams,
    type ContainerAppsGetOptionalParams,
} from '@azure/arm-appcontainers/api/containerApps';
import {
    getRevision as sdkGetRevision,
    restartRevision as sdkRestartRevision,
    type ContainerAppsRevisionsGetRevisionOptionalParams,
    type ContainerAppsRevisionsRestartRevisionOptionalParams,
} from '@azure/arm-appcontainers/api/containerAppsRevisions';
import { get as sdkGetManagedEnvironment, type ManagedEnvironmentsGetOptionalParams } from '@azure/arm-appcontainers/api/managedEnvironments';
import type {
    Container,
    ContainerApp as SdkContainerApp,
    ContainerAppAuthToken,
    ManagedEnvironment as SdkManagedEnvironment,
    Replica,
    Revision as SdkRevision,
} from '@azure/arm-appcontainers/models';
import type { TokenCredential } from '@azure/core-auth';
import type { IActionExecutor, ICodeContext, SyncFactory, WithRequired } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import type { AzureSubscription } from '../../auth/AzureSubscription';
import { createArmRestSubscriptionClient } from '../createAzureClient';

/** Subset of the SDK container app with the fields ARM always returns. */
export type ContainerApp = WithRequired<SdkContainerApp, 'id' | 'name' | 'type' | 'location'>;
/** Subset of the SDK revision with the fields ARM always returns. */
export type Revision = WithRequired<SdkRevision, 'id' | 'name' | 'type'>;
/** Subset of the SDK managed environment with the fields ARM always returns. */
export type ManagedEnvironment = WithRequired<SdkManagedEnvironment, 'id' | 'name' | 'type' | 'location'>;

export type { Container, ContainerAppAuthToken, Replica };

/** Factory that creates an {@linkcode IContainerAppsClient} for a given subscription. */
export const IContainerAppsClientProvider: ServiceIdentifier<IContainerAppsClientProvider> = Symbol.for('IContainerAppsClientProvider');
export type IContainerAppsClientProvider = SyncFactory<IContainerAppsClient, [AzureSubscription]>;

/**
 * Interface describing the Container Apps management APIs we use.
 *
 * The `@azure/arm-appcontainers` SDK uses a 'free function + context' pattern
 * (`get(context, rg, name)`). This interface normalizes it to the familiar
 * `client.containerApps.get(rg, name)` shape.
 */
export interface IContainerAppsClient {
    readonly containerApps: {
        get(resourceGroupName: string, containerAppName: string, options?: ContainerAppsGetOptionalParams): Promise<ContainerApp>;
        /**
         * Exchanges the caller's ARM credentials for a short-lived token scoped
         * to the app's data plane, which is what the log-stream endpoint accepts.
         */
        getAuthToken(resourceGroupName: string, containerAppName: string, options?: ContainerAppsGetAuthTokenOptionalParams): Promise<ContainerAppAuthToken>;
    };
    readonly containerAppsRevisions: {
        getRevision(resourceGroupName: string, containerAppName: string, revisionName: string, options?: ContainerAppsRevisionsGetRevisionOptionalParams): Promise<Revision>;
        restartRevision(resourceGroupName: string, containerAppName: string, revisionName: string, options?: ContainerAppsRevisionsRestartRevisionOptionalParams): Promise<void>;
    };
    readonly managedEnvironments: {
        get(resourceGroupName: string, environmentName: string, options?: ManagedEnvironmentsGetOptionalParams): Promise<ManagedEnvironment>;
    };
}

/**
 * Wrapper around the `@azure/arm-appcontainers` REST-style SDK that adapts free
 * functions into the `client.<operationGroup>.*` pattern.
 *
 * Use the static {@linkcode create} factory to construct.
 */
export class ContainerAppsClient implements IContainerAppsClient {
    private constructor(
        private readonly inner: ContainerAppsAPIContext,
    ) { }

    /**
     * Create a new {@linkcode ContainerAppsClient} instance.
     */
    public static create(
        ctx: ICodeContext,
        executor: IActionExecutor,
        credential: TokenCredential,
        subscription: AzureSubscription,
        options?: ContainerAppsAPIClientOptionalParams,
    ): ContainerAppsClient {
        const context = createArmRestSubscriptionClient(
            ctx,
            executor,
            createContainerAppsAPI,
            credential,
            subscription,
            options,
        );
        return new ContainerAppsClient(context);
    }

    public get containerApps(): IContainerAppsClient['containerApps'] {
        return {
            get: (resourceGroupName, containerAppName, options) =>
                sdkGetContainerApp(this.inner, resourceGroupName, containerAppName, options) as Promise<ContainerApp>,
            getAuthToken: (resourceGroupName, containerAppName, options) =>
                sdkGetAuthToken(this.inner, resourceGroupName, containerAppName, options),
        };
    }

    public get containerAppsRevisions(): IContainerAppsClient['containerAppsRevisions'] {
        return {
            getRevision: (resourceGroupName, containerAppName, revisionName, options) =>
                sdkGetRevision(this.inner, resourceGroupName, containerAppName, revisionName, options) as Promise<Revision>,
            restartRevision: (resourceGroupName, containerAppName, revisionName, options) =>
                sdkRestartRevision(this.inner, resourceGroupName, containerAppName, revisionName, options),
        };
    }

    public get managedEnvironments(): IContainerAppsClient['managedEnvironments'] {
        return {
            get: (resourceGroupName, environmentName, options) =>
                sdkGetManagedEnvironment(this.inner, resourceGroupName, environmentName, options) as Promise<ManagedEnvironment>,
        };
    }
}
