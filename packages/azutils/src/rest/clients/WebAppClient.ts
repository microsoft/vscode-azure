/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { StringDictionary, WebSiteManagementClientOptionalParams } from '@azure/arm-appservice';
import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import type { AsyncFactory, IActionExecutor, ICodeContext } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import { createAzureSubscriptionClient } from '../createAzureClient';

/** Factory that creates an {@link IWebAppClient} for a given subscription. */
export const IWebAppClientProvider: ServiceIdentifier<IWebAppClientProvider> = Symbol.for('IWebAppClientProvider');
export type IWebAppClientProvider = AsyncFactory<IWebAppClient, [AzureSubscription]>;

/**
 * Interface describing the App Service management APIs we use.
 */
export interface IWebAppClient {
    readonly webApps: {
        listApplicationSettings(resourceGroupName: string, name: string): Promise<StringDictionary>;
        updateApplicationSettings(resourceGroupName: string, name: string, appSettings: StringDictionary): Promise<StringDictionary>;
    };
}

/**
 * Wrapper around `WebSiteManagementClient` that exposes only the methods
 * we use.
 *
 * Uses the classic SDK class pattern (like {@link ResourceClient}), with
 * lazy imports to keep load times down.
 */
export class WebAppClient implements IWebAppClient {
    private static sdk: typeof import('@azure/arm-appservice') | undefined;

    private constructor(
        private readonly inner: import('@azure/arm-appservice').WebSiteManagementClient,
    ) { }

    /**
     * Create a new {@link WebAppClient} instance. Lazily imports
     * `@azure/arm-appservice` on first call.
     */
    public static async create(
        ctx: ICodeContext,
        executor: IActionExecutor,
        subscription: AzureSubscription,
        options?: WebSiteManagementClientOptionalParams,
    ): Promise<WebAppClient> {
        WebAppClient.sdk ??= await import('@azure/arm-appservice');
        const inner = createAzureSubscriptionClient(
            ctx,
            executor,
            WebAppClient.sdk.WebSiteManagementClient,
            subscription,
            options,
        );
        return new WebAppClient(inner);
    }

    public get webApps(): IWebAppClient['webApps'] {
        return {
            listApplicationSettings: (resourceGroupName, name) =>
                this.inner.webApps.listApplicationSettings(resourceGroupName, name),
            updateApplicationSettings: (resourceGroupName, name, appSettings) =>
                this.inner.webApps.updateApplicationSettings(resourceGroupName, name, appSettings),
        };
    }
}
