/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AzureNodeId,
    parseAzureResourceId,
    type IStaticWebAppClient,
    type IStaticWebAppClientProvider,
} from '@microsoft/vscode-azure-azutils';
import { AppSettingsModel, type IAppSettingsClient } from '../appSettings/AppSettingsModel';
import type { StaticWebAppAppSettingsGroup } from './StaticWebApp';

/**
 * Static Web Apps adapter over the shared app-settings model.
 *
 * Production environments use the site-level endpoints; preview environments
 * use build-level endpoints. The group node is the complete command-facing
 * handle, so later commands do not need to reconstruct parent relationships.
 */
export class StaticWebAppAppSettings {
    private readonly clients = new Map<string, IStaticWebAppClient>();
    private readonly model: AppSettingsModel<StaticWebAppAppSettingsGroup>;

    public constructor(private readonly createClient: IStaticWebAppClientProvider) {
        this.model = new AppSettingsModel(
            group => AzureNodeId.from(group).toString(),
            group => this.createAppSettingsClient(group),
        );
    }

    /** Lists setting names and primes the value cache used by edit commands. */
    public list(group: StaticWebAppAppSettingsGroup): Promise<string[]> {
        return this.model.list(group);
    }

    /** Returns a cached setting value without exposing it in tree-node data. */
    public getValue(group: StaticWebAppAppSettingsGroup, key: string): string | undefined {
        return this.model.getValue(group, key);
    }

    /** Adds or replaces one remote setting. */
    public addOrUpdate(group: StaticWebAppAppSettingsGroup, key: string, value: string): Promise<void> {
        return this.model.addOrUpdate(group, key, value);
    }

    /** Reads and caches all current settings. */
    public getAll(group: StaticWebAppAppSettingsGroup): Promise<Record<string, string>> {
        return this.model.getAll(group);
    }

    /** Deletes one remote setting. */
    public delete(group: StaticWebAppAppSettingsGroup, key: string): Promise<void> {
        return this.model.delete(group, key);
    }

    /** Renames one remote setting. */
    public rename(group: StaticWebAppAppSettingsGroup, oldKey: string, newKey: string): Promise<boolean> {
        return this.model.rename(group, oldKey, newKey);
    }

    /** Replaces all remote settings. */
    public replace(group: StaticWebAppAppSettingsGroup, settings: Record<string, string>): Promise<void> {
        return this.model.replace(group, settings);
    }

    private createAppSettingsClient(group: StaticWebAppAppSettingsGroup): IAppSettingsClient {
        const client = this.getClient(group);
        const { resourceGroup } = parseAzureResourceId(group.azureResource.id);
        if (!resourceGroup) {
            throw new Error(`Cannot extract resource group name from resource ID: ${group.azureResource.id}`);
        }

        const staticSites = client.staticSites;
        if (group.isProduction) {
            return {
                list: async () => {
                    const response = await staticSites.listStaticSiteFunctionAppSettings(resourceGroup, group.azureResource.name);
                    return { ...response.properties };
                },
                update: async settings => {
                    const response = await staticSites.createOrUpdateStaticSiteFunctionAppSettings(
                        resourceGroup,
                        group.azureResource.name,
                        { properties: settings },
                    );
                    return { ...response.properties };
                },
            };
        }

        return {
            list: async () => {
                const response = await staticSites.listStaticSiteBuildFunctionAppSettings(
                    resourceGroup,
                    group.azureResource.name,
                    group.environmentBuildId,
                );
                return { ...response.properties };
            },
            update: async settings => {
                const response = await staticSites.createOrUpdateStaticSiteBuildFunctionAppSettings(
                    resourceGroup,
                    group.azureResource.name,
                    group.environmentBuildId,
                    { properties: settings },
                );
                return { ...response.properties };
            },
        };
    }

    private getClient(group: StaticWebAppAppSettingsGroup): IStaticWebAppClient {
        const subscriptionId = group.azureResource.subscription.subscriptionId;
        let client = this.clients.get(subscriptionId);
        if (!client) {
            client = this.createClient(group.azureResource.subscription);
            this.clients.set(subscriptionId, client);
        }
        return client;
    }
}
