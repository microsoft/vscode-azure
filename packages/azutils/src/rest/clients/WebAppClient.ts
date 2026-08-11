/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type WebSiteManagementClientOptionalParams, type WebSiteManagementContext, createWebSiteManagement } from '@azure/arm-appservice/api';
import {
    listApplicationSettings as sdkListApplicationSettings,
    listConnectionStrings as sdkListConnectionStrings,
    updateApplicationSettings as sdkUpdateApplicationSettings,
    updateConnectionStrings as sdkUpdateConnectionStrings,
} from '@azure/arm-appservice/api/webApps';
import type { ConnectionStringDictionary, ConnectionStringType, ConnStringValueTypePair, StringDictionary } from '@azure/arm-appservice/models';
import type { TokenCredential } from '@azure/core-auth';
import type { IActionExecutor, ICodeContext, SyncFactory } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import type { AzureSubscription } from '../../auth/AzureSubscription';
import { createArmRestSubscriptionClient } from '../createAzureClient';

// Re-exported so consumers depend on this wrapper rather than on `@azure/*` directly.
export type { ConnectionStringDictionary, ConnectionStringType, ConnStringValueTypePair, StringDictionary };

/**
 * The database types a connection string may declare, as accepted by ARM.
 *
 * Exposed as a runtime array so callers can offer it as a pick list and validate user input. The
 * SDK has no `KnownConnectionStringType` enum to reuse: unlike most of its enums it models this one
 * as a bare string-literal union (`ConnectionStringType`), which is erased at compile time. The
 * similarly-named `KnownDatabaseType` is a different type for a different field (site backups), with
 * only four members and different casing -- `SqlAzure` rather than `SQLAzure` -- so it is not
 * interchangeable. Typing this array as `ConnectionStringType[]` keeps it checked against the SDK,
 * so a member added or renamed upstream fails the build here.
 */
export const ConnectionStringTypes: readonly ConnectionStringType[] = [
    'MySql', 'SQLServer', 'SQLAzure', 'Custom', 'NotificationHub',
    'ServiceBus', 'EventHub', 'ApiHub', 'DocDb', 'RedisCache', 'PostgreSQL',
];

/** Factory that creates an {@linkcode IWebAppClient} for a given subscription. */
export const IWebAppClientProvider: ServiceIdentifier<IWebAppClientProvider> = Symbol.for('IWebAppClientProvider');
export type IWebAppClientProvider = SyncFactory<IWebAppClient, [AzureSubscription]>;

/**
 * Interface describing the App Service management APIs we use.
 *
 * @remarks
 * Both settings collections are read-modify-write over the *whole* dictionary: ARM exposes no
 * per-key patch, so `update*` replaces the entire collection and omitting a key deletes it.
 */
export interface IWebAppClient {
    readonly webApps: {
        listApplicationSettings(resourceGroupName: string, name: string): Promise<StringDictionary>;
        updateApplicationSettings(resourceGroupName: string, name: string, appSettings: StringDictionary): Promise<StringDictionary>;
        listConnectionStrings(resourceGroupName: string, name: string): Promise<ConnectionStringDictionary>;
        updateConnectionStrings(resourceGroupName: string, name: string, connectionStrings: ConnectionStringDictionary): Promise<ConnectionStringDictionary>;
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
            listApplicationSettings: (resourceGroupName, name) =>
                sdkListApplicationSettings(this.inner, resourceGroupName, name),
            updateApplicationSettings: (resourceGroupName, name, appSettings) =>
                sdkUpdateApplicationSettings(this.inner, resourceGroupName, name, appSettings),
            listConnectionStrings: (resourceGroupName, name) =>
                sdkListConnectionStrings(this.inner, resourceGroupName, name),
            updateConnectionStrings: (resourceGroupName, name, connectionStrings) =>
                sdkUpdateConnectionStrings(this.inner, resourceGroupName, name, connectionStrings),
        };
    }
}
