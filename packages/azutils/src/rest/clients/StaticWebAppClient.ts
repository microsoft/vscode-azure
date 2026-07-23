/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createWebSiteManagement, type WebSiteManagementClientOptionalParams, type WebSiteManagementContext } from '@azure/arm-appservice/api';
import {
    createOrUpdateStaticSiteBuildFunctionAppSettings as sdkCreateOrUpdateStaticSiteBuildFunctionAppSettings,
    createOrUpdateStaticSiteFunctionAppSettings as sdkCreateOrUpdateStaticSiteFunctionAppSettings,
    deleteStaticSite as sdkDeleteStaticSite,
    deleteStaticSiteBuild as sdkDeleteStaticSiteBuild,
    getStaticSite as sdkGetStaticSite,
    getStaticSiteBuild as sdkGetStaticSiteBuild,
    listStaticSiteBuildFunctionAppSettings as sdkListStaticSiteBuildFunctionAppSettings,
    listStaticSiteBuildFunctions as sdkListStaticSiteBuildFunctions,
    listStaticSiteBuilds as sdkListStaticSiteBuilds,
    listStaticSiteFunctionAppSettings as sdkListStaticSiteFunctionAppSettings,
    listStaticSiteFunctions as sdkListStaticSiteFunctions,
    type StaticSitesCreateOrUpdateStaticSiteBuildFunctionAppSettingsOptionalParams,
    type StaticSitesCreateOrUpdateStaticSiteFunctionAppSettingsOptionalParams,
    type StaticSitesDeleteStaticSiteBuildOptionalParams,
    type StaticSitesDeleteStaticSiteOptionalParams,
    type StaticSitesGetStaticSiteBuildOptionalParams,
    type StaticSitesGetStaticSiteOptionalParams,
    type StaticSitesListStaticSiteBuildFunctionAppSettingsOptionalParams,
    type StaticSitesListStaticSiteBuildFunctionsOptionalParams,
    type StaticSitesListStaticSiteBuildsOptionalParams,
    type StaticSitesListStaticSiteFunctionAppSettingsOptionalParams,
    type StaticSitesListStaticSiteFunctionsOptionalParams,
} from '@azure/arm-appservice/api/staticSites';
import type {
    StaticSiteARMResource,
    StaticSiteBuildARMResource,
    StaticSiteFunctionOverviewARMResource,
    StringDictionary,
} from '@azure/arm-appservice/models';
import type { TokenCredential } from '@azure/core-auth';
import type { IActionExecutor, ICodeContext, Page, SyncFactory } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import type { AzureSubscription } from '../../auth/AzureSubscription';
import { createArmRestSubscriptionClient } from '../createAzureClient';
import { toPages } from '../toPages';

export type { WebSiteManagementClientOptionalParams } from '@azure/arm-appservice/api';
export type {
    StaticSitesCreateOrUpdateStaticSiteBuildFunctionAppSettingsOptionalParams,
    StaticSitesCreateOrUpdateStaticSiteFunctionAppSettingsOptionalParams,
    StaticSitesDeleteStaticSiteBuildOptionalParams,
    StaticSitesDeleteStaticSiteOptionalParams,
    StaticSitesGetStaticSiteBuildOptionalParams,
    StaticSitesGetStaticSiteOptionalParams,
    StaticSitesListStaticSiteBuildFunctionAppSettingsOptionalParams,
    StaticSitesListStaticSiteBuildFunctionsOptionalParams,
    StaticSitesListStaticSiteBuildsOptionalParams,
    StaticSitesListStaticSiteFunctionAppSettingsOptionalParams,
    StaticSitesListStaticSiteFunctionsOptionalParams,
} from '@azure/arm-appservice/api/staticSites';
export type {
    StaticSiteARMResource,
    StaticSiteBuildARMResource,
    StaticSiteFunctionOverviewARMResource,
    StringDictionary,
} from '@azure/arm-appservice/models';
export type { TokenCredential } from '@azure/core-auth';

/** Factory that creates an {@linkcode IStaticWebAppClient} for a subscription. */
export const IStaticWebAppClientProvider: ServiceIdentifier<IStaticWebAppClientProvider> = Symbol.for('IStaticWebAppClientProvider');
export type IStaticWebAppClientProvider = SyncFactory<IStaticWebAppClient, [AzureSubscription]>;

/**
 * Static Web Apps management operations used by resource providers and commands.
 *
 * List operations use the shared {@linkcode Page} abstraction, and delete
 * operations wait for their ARM long-running operations to finish.
 */
export interface IStaticWebAppClient {
    readonly staticSites: {
        getStaticSite(resourceGroupName: string, name: string, options?: StaticSitesGetStaticSiteOptionalParams): Promise<StaticSiteARMResource>;
        listStaticSiteBuilds(resourceGroupName: string, name: string, options?: StaticSitesListStaticSiteBuildsOptionalParams): AsyncIterable<Page<StaticSiteBuildARMResource>>;
        getStaticSiteBuild(resourceGroupName: string, name: string, environmentName: string, options?: StaticSitesGetStaticSiteBuildOptionalParams): Promise<StaticSiteBuildARMResource>;
        deleteStaticSiteBuild(resourceGroupName: string, name: string, environmentName: string, options?: StaticSitesDeleteStaticSiteBuildOptionalParams): Promise<void>;
        listStaticSiteFunctions(resourceGroupName: string, name: string, options?: StaticSitesListStaticSiteFunctionsOptionalParams): AsyncIterable<Page<StaticSiteFunctionOverviewARMResource>>;
        listStaticSiteBuildFunctions(resourceGroupName: string, name: string, environmentName: string, options?: StaticSitesListStaticSiteBuildFunctionsOptionalParams): AsyncIterable<Page<StaticSiteFunctionOverviewARMResource>>;
        listStaticSiteFunctionAppSettings(resourceGroupName: string, name: string, options?: StaticSitesListStaticSiteFunctionAppSettingsOptionalParams): Promise<StringDictionary>;
        listStaticSiteBuildFunctionAppSettings(resourceGroupName: string, name: string, environmentName: string, options?: StaticSitesListStaticSiteBuildFunctionAppSettingsOptionalParams): Promise<StringDictionary>;
        createOrUpdateStaticSiteFunctionAppSettings(resourceGroupName: string, name: string, appSettings: StringDictionary, options?: StaticSitesCreateOrUpdateStaticSiteFunctionAppSettingsOptionalParams): Promise<StringDictionary>;
        createOrUpdateStaticSiteBuildFunctionAppSettings(resourceGroupName: string, name: string, environmentName: string, appSettings: StringDictionary, options?: StaticSitesCreateOrUpdateStaticSiteBuildFunctionAppSettingsOptionalParams): Promise<StringDictionary>;
        deleteStaticSite(resourceGroupName: string, name: string, options?: StaticSitesDeleteStaticSiteOptionalParams): Promise<void>;
    };
}

/**
 * Typed adapter over the `@azure/arm-appservice` Static Sites REST-style API.
 *
 * Use {@linkcode StaticWebAppClient.create} to construct an instance.
 */
export class StaticWebAppClient implements IStaticWebAppClient {
    private constructor(private readonly inner: WebSiteManagementContext) { }

    /** Creates a client configured for the subscription's ARM environment. */
    public static create(
        ctx: ICodeContext,
        executor: IActionExecutor,
        credential: TokenCredential,
        subscription: AzureSubscription,
        options?: WebSiteManagementClientOptionalParams,
    ): StaticWebAppClient {
        const context = createArmRestSubscriptionClient(
            ctx,
            executor,
            createWebSiteManagement,
            credential,
            subscription,
            options,
        );
        return new StaticWebAppClient(context);
    }

    public get staticSites(): IStaticWebAppClient['staticSites'] {
        return {
            getStaticSite: (...args) => sdkGetStaticSite(this.inner, ...args),
            listStaticSiteBuilds: (...args) => toPages(sdkListStaticSiteBuilds(this.inner, ...args)),
            getStaticSiteBuild: (...args) => sdkGetStaticSiteBuild(this.inner, ...args),
            deleteStaticSiteBuild: async (...args) => {
                await sdkDeleteStaticSiteBuild(this.inner, ...args).pollUntilDone();
            },
            listStaticSiteFunctions: (...args) => toPages(sdkListStaticSiteFunctions(this.inner, ...args)),
            listStaticSiteBuildFunctions: (...args) => toPages(sdkListStaticSiteBuildFunctions(this.inner, ...args)),
            listStaticSiteFunctionAppSettings: (...args) => sdkListStaticSiteFunctionAppSettings(this.inner, ...args),
            listStaticSiteBuildFunctionAppSettings: (...args) => sdkListStaticSiteBuildFunctionAppSettings(this.inner, ...args),
            createOrUpdateStaticSiteFunctionAppSettings: (...args) => sdkCreateOrUpdateStaticSiteFunctionAppSettings(this.inner, ...args),
            createOrUpdateStaticSiteBuildFunctionAppSettings: (...args) => sdkCreateOrUpdateStaticSiteBuildFunctionAppSettings(this.inner, ...args),
            deleteStaticSite: async (...args) => {
                await sdkDeleteStaticSite(this.inner, ...args).pollUntilDone();
            },
        };
    }
}
