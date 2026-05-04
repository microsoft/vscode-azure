/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { StringDictionary } from '@azure/arm-appservice/models';
/* eslint-disable @typescript-eslint/no-restricted-imports -- The new-style SDK actually bundles smaller if it is eagerly imported */
import { type WebSiteManagementClientOptionalParams, type WebSiteManagementContext, createWebSiteManagement } from '@azure/arm-appservice/api';
import { listApplicationSettings as sdkListApplicationSettings, updateApplicationSettings as sdkUpdateApplicationSettings } from '@azure/arm-appservice/api/webApps';
/* eslint-enable @typescript-eslint/no-restricted-imports */
import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import type { AsyncFactory, IActionExecutor, ICodeContext } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import { createAzureRestSubscriptionClient } from '../createAzureClient';

/** Factory that creates an {@linkcode IWebAppClient} for a given subscription. */
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
    ): Promise<WebAppClient> {
        const context = createAzureRestSubscriptionClient(
            ctx,
            executor,
            createWebSiteManagement,
            subscription,
            options,
        );
        return Promise.resolve(new WebAppClient(context));
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
