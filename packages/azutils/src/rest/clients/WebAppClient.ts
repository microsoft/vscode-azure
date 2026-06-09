/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type WebSiteManagementClientOptionalParams, type WebSiteManagementContext, createWebSiteManagement } from '@azure/arm-appservice/api';
import { listApplicationSettings as sdkListApplicationSettings, updateApplicationSettings as sdkUpdateApplicationSettings } from '@azure/arm-appservice/api/webApps';
import type { StringDictionary } from '@azure/arm-appservice/models';
import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import type { IActionExecutor, ICodeContext, SyncFactory } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import { createAzureRestSubscriptionClient } from '../createAzureClient';

/** Factory that creates an {@linkcode IWebAppClient} for a given subscription. */
export const IWebAppClientProvider: ServiceIdentifier<IWebAppClientProvider> = Symbol.for('IWebAppClientProvider');
export type IWebAppClientProvider = SyncFactory<IWebAppClient, [AzureSubscription]>;

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
 * Wrapper around the `@azure/arm-appservice` REST-style SDK that adapts free
 * functions into the `client.webApps.*` pattern.
 *
 * Use the static {@linkcode create} factory to construct.
 */
export class WebAppClient implements IWebAppClient {
    private constructor(
        private readonly inner: WebSiteManagementContext,
    ) { }

    /**
     * Create a new {@linkcode WebAppClient} instance.
     */
    public static create(
        ctx: ICodeContext,
        executor: IActionExecutor,
        subscription: AzureSubscription,
        options?: WebSiteManagementClientOptionalParams,
    ): WebAppClient {
        const context = createAzureRestSubscriptionClient(
            ctx,
            executor,
            createWebSiteManagement,
            subscription,
            options,
        );
        return new WebAppClient(context);
    }

    public get webApps(): IWebAppClient['webApps'] {
        return {
            listApplicationSettings: (resourceGroupName, name) =>
                sdkListApplicationSettings(this.inner, resourceGroupName, name),
            updateApplicationSettings: (resourceGroupName, name, appSettings) =>
                sdkUpdateApplicationSettings(this.inner, resourceGroupName, name, appSettings),
        };
    }
}
