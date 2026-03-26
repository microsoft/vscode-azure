/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { RegistriesGetOptionalParams } from '@azure/arm-containerregistry';
import type { Registry as SdkRegistry, Sku as SdkSku } from '@azure/arm-containerregistry/models';
/* eslint-disable @typescript-eslint/no-restricted-imports -- The new-style SDK actually bundles smaller if it is eagerly imported */
import { type ContainerRegistryManagementClientOptionalParams, type ContainerRegistryManagementContext, createContainerRegistryManagement } from '@azure/arm-containerregistry/api';
import { get as sdkGetRegistry } from '@azure/arm-containerregistry/api/registries';
/* eslint-enable @typescript-eslint/no-restricted-imports */
import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import type { AsyncFactory, IActionExecutor, ICodeContext, WithRequired } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import { createAzureRestSubscriptionClient } from '../createAzureClient';

/**
 * Subset of {@link Registry} with fields that the ARM API always returns.
 */
export type Registry = WithRequired<SdkRegistry, 'id' | 'name' | 'type' | 'location'>;
export type Sku = SdkSku;

/** Factory that creates an {@link IAcrClient} for a given subscription. */
export const IAcrClientProvider: ServiceIdentifier<IAcrClientProvider> = Symbol.for('IAcrClientProvider');
export type IAcrClientProvider = AsyncFactory<IAcrClient, [AzureSubscription]>;

/**
 * Interface describing the container registry APIs we use.
 *
 * The real `@azure/arm-containerregistry` SDK uses a 'free function + context'
 * pattern (`get(context, rg, name)`). This interface normalizes it to the
 * familiar `client.registries.get(rg, name)` shape.
 */
export interface IAcrClient {
    readonly registries: {
        get: (resourceGroupName: string, registryName: string, options?: RegistriesGetOptionalParams) => Promise<Registry>;
    };
}

/**
 * Wrapper around the `@azure/arm-containerregistry` REST-style SDK that
 * adapts free functions into the `client.registries.get()` pattern.
 *
 * Use the static {@link create} factory to construct
 */
export class AcrClient implements IAcrClient {
    private constructor(
        private readonly inner: ContainerRegistryManagementContext,
        private readonly getRegistry: typeof sdkGetRegistry,
    ) { }

    /**
     * Create a new {@link AcrClient} instance.
     */
    public static create(
        ctx: ICodeContext,
        executor: IActionExecutor,
        subscription: AzureSubscription,
        options?: ContainerRegistryManagementClientOptionalParams,
    ): Promise<AcrClient> {
        const context = createAzureRestSubscriptionClient(
            ctx,
            executor,
            createContainerRegistryManagement,
            subscription,
            options,
        );
        return Promise.resolve(new AcrClient(context, sdkGetRegistry));
    }

    public get registries(): IAcrClient['registries'] {
        return {
            get: (...args) => this.getRegistry(this.inner, ...args) as Promise<Registry>,
        };
    }
}
