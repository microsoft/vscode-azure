/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type WebSiteManagementClientOptionalParams, type WebSiteManagementContext, createWebSiteManagement } from '@azure/arm-appservice/api';
import {
    getFunction as sdkGetFunction,
    get as sdkGetWebApp,
    listApplicationSettings as sdkListApplicationSettings,
    listFunctionKeys as sdkListFunctionKeys,
    listFunctionSecrets as sdkListFunctionSecrets,
    listFunctions as sdkListFunctions,
    listHostKeys as sdkListHostKeys,
    restart as sdkRestart,
    start as sdkStart,
    stop as sdkStop,
    updateApplicationSettings as sdkUpdateApplicationSettings,
    type WebAppsGetOptionalParams,
} from '@azure/arm-appservice/api/webApps';
import type { FunctionEnvelope, FunctionSecrets, HostKeys, Site, StringDictionary } from '@azure/arm-appservice/models';
import type { TokenCredential } from '@azure/core-auth';
import type { IActionExecutor, ICodeContext, Page, SyncFactory } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import type { AzureSubscription } from '../../auth/AzureSubscription';
import { createArmRestSubscriptionClient } from '../createAzureClient';
import { toPages } from '../toPages';

export type { FunctionEnvelope, FunctionSecrets, HostKeys, Site, StringDictionary, WebAppsGetOptionalParams };

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
        start(resourceGroupName: string, name: string): Promise<void>;
        stop(resourceGroupName: string, name: string): Promise<void>;
        restart(resourceGroupName: string, name: string): Promise<void>;
        listFunctions(resourceGroupName: string, name: string): AsyncIterable<Page<FunctionEnvelope>>;
        getFunction(resourceGroupName: string, name: string, functionName: string): Promise<FunctionEnvelope>;
        listFunctionKeys(resourceGroupName: string, name: string, functionName: string): Promise<StringDictionary>;
        listHostKeys(resourceGroupName: string, name: string): Promise<HostKeys>;
        listFunctionSecrets(resourceGroupName: string, name: string, functionName: string): Promise<FunctionSecrets>;
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
            start: (...args) => sdkStart(this.inner, ...args),
            stop: (...args) => sdkStop(this.inner, ...args),
            restart: (...args) => sdkRestart(this.inner, ...args),
            listFunctions: (...args) => toPages(sdkListFunctions(this.inner, ...args)),
            getFunction: (...args) => sdkGetFunction(this.inner, ...args),
            listFunctionKeys: (...args) => sdkListFunctionKeys(this.inner, ...args),
            listHostKeys: (...args) => sdkListHostKeys(this.inner, ...args),
            listFunctionSecrets: (...args) => sdkListFunctionSecrets(this.inner, ...args),
        };
    }
}
