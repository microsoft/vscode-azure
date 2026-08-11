/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type WebSiteManagementClientOptionalParams, type WebSiteManagementContext, createWebSiteManagement } from '@azure/arm-appservice/api';
import { getStaticSite as sdkGetStaticSite, type StaticSitesGetStaticSiteOptionalParams } from '@azure/arm-appservice/api/staticSites';
import { get as sdkGetWebApp, listApplicationSettings as sdkListApplicationSettings, updateApplicationSettings as sdkUpdateApplicationSettings, type WebAppsGetOptionalParams } from '@azure/arm-appservice/api/webApps';
import type { Site, StaticSiteARMResource, StringDictionary } from '@azure/arm-appservice/models';
import type { TokenCredential } from '@azure/core-auth';
import type { IActionExecutor, ICodeContext, SyncFactory } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import type { AzureSubscription } from '../../auth/AzureSubscription';
import { createArmRestSubscriptionClient } from '../createAzureClient';

export type { Site, StaticSiteARMResource, StaticSitesGetStaticSiteOptionalParams, StringDictionary, WebAppsGetOptionalParams };

/** Factory that creates an {@linkcode IWebAppClient} for a given subscription. */
export const IWebAppClientProvider: ServiceIdentifier<IWebAppClientProvider> = Symbol.for('IWebAppClientProvider');
export type IWebAppClientProvider = SyncFactory<IWebAppClient, [AzureSubscription]>;

/**
 * Interface describing the App Service management APIs we use.
 */
export interface IWebAppClient {
    readonly webApps: {
        get(resourceGroupName: string, name: string, options?: WebAppsGetOptionalParams): Promise<Site>;
        listApplicationSettings(resourceGroupName: string, name: string): Promise<StringDictionary>;
        updateApplicationSettings(resourceGroupName: string, name: string, appSettings: StringDictionary): Promise<StringDictionary>;
    };
    readonly staticSites: {
        getStaticSite(resourceGroupName: string, name: string, options?: StaticSitesGetStaticSiteOptionalParams): Promise<StaticSiteARMResource>;
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
        credential: TokenCredential,
        subscription: AzureSubscription,
        options?: WebSiteManagementClientOptionalParams,
    ): WebAppClient {
        const context = createArmRestSubscriptionClient(
            ctx,
            executor,
            createWebSiteManagement,
            credential,
            subscription,
            options,
        );
        return new WebAppClient(context);
    }

    public get webApps(): IWebAppClient['webApps'] {
        return {
            get: (resourceGroupName, name, options) =>
                sdkGetWebApp(this.inner, resourceGroupName, name, options),
            listApplicationSettings: (resourceGroupName, name) =>
                sdkListApplicationSettings(this.inner, resourceGroupName, name),
            updateApplicationSettings: (resourceGroupName, name, appSettings) =>
                sdkUpdateApplicationSettings(this.inner, resourceGroupName, name, appSettings),
        };
    }

    public get staticSites(): IWebAppClient['staticSites'] {
        return {
            getStaticSite: (resourceGroupName, name, options) =>
                sdkGetStaticSite(this.inner, resourceGroupName, name, options),
        };
    }
}
