/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    getNodeType, IWebAppClientProvider, isVirtualResource, parseAzureResourceId,
    type ConcreteAzureNode, type GenericResource, type IWebAppClient, type VirtualResource
} from '@microsoft/vscode-azure-azutils';
import { IActionExecutor, InflightMap, type DataProvider } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { isFunctionApp } from './FunctionApp';

/**
 * Data-layer provider for Azure Function Apps.
 *
 * - **`canHandle`**: matches Function App resources and their virtual children
 * - **`getChildren`**: returns virtual category nodes (App Settings) and
 *   individual app setting leaf nodes fetched from the ARM API
 *
 * Caches app settings per Function App so that CRUD commands can read/write
 * values without re-fetching. The cache is invalidated after mutations.
 */
@injectable()
export class FunctionAppDataProvider implements DataProvider<ConcreteAzureNode> {

    private readonly clientCache = new InflightMap<IWebAppClient>();

    /**
     * In-memory cache of app settings keyed by ARM resource ID.
     * Populated when listing children, used by CRUD commands to
     * avoid redundant API calls.
     */
    private readonly settingsCache = new Map<string, Record<string, string>>();

    public constructor(
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IWebAppClientProvider) private readonly createClient: IWebAppClientProvider,
    ) { }

    public canHandle(resource: unknown): resource is ConcreteAzureNode {
        return isFunctionApp(resource) || isFunctionAppVirtualResource(resource);
    }

    public async getChildren(resource?: ConcreteAzureNode): Promise<ConcreteAzureNode[]> {
        if (!resource) {
            return [];
        }

        this.executor.setTelProp('nodeType', getNodeType(resource));

        // Function App → category nodes
        if (isFunctionApp(resource)) {
            return [
                { virtualType: 'functionApp.appSettings', virtualPath: 'App Settings', azureResource: resource },
            ];
        }

        // App Settings category → individual settings
        if (isVirtualResource(resource) && resource.virtualType === 'functionApp.appSettings') {
            return await this.listAppSettings(resource);
        }

        return [];
    }

    /**
     * Get the cached value for a specific app setting.
     * Returns `undefined` if the setting or cache is missing.
     */
    public getSettingValue(resourceId: string, settingKey: string): string | undefined {
        return this.settingsCache.get(resourceId)?.[settingKey];
    }

    /**
     * Add or update an app setting. Merges into the remote settings,
     * updates the cache, and returns the resource group + site info
     * needed by callers to invalidate the tree.
     */
    public async addOrUpdateSetting(resource: GenericResource, key: string, value: string): Promise<void> {
        const { client, resourceGroupName } = await this.resolveClient(resource);

        const current = await client.webApps.listApplicationSettings(resourceGroupName, resource.name);
        const properties = { ...current.properties, [key]: value };
        await client.webApps.updateApplicationSettings(resourceGroupName, resource.name, { ...current, properties });

        // Update local cache
        this.settingsCache.set(resource.id, properties);
    }

    /**
     * Delete an app setting by key.
     */
    public async deleteSetting(resource: GenericResource, key: string): Promise<void> {
        const { client, resourceGroupName } = await this.resolveClient(resource);

        const current = await client.webApps.listApplicationSettings(resourceGroupName, resource.name);
        const remaining = Object.fromEntries(
            Object.entries({ ...current.properties }).filter(([k]) => k !== key)
        );
        await client.webApps.updateApplicationSettings(resourceGroupName, resource.name, { ...current, properties: remaining });

        // Update local cache
        this.settingsCache.set(resource.id, remaining);
    }

    private async listAppSettings(resource: VirtualResource): Promise<ConcreteAzureNode[]> {
        const { client, resourceGroupName } = await this.resolveClient(resource.azureResource);

        const settings = await client.webApps.listApplicationSettings(resourceGroupName, resource.azureResource.name);
        const properties = settings.properties ?? {};

        // Cache the full settings map
        this.settingsCache.set(resource.azureResource.id, { ...properties });

        return Object.keys(properties).sort().map(key => ({
            virtualType: 'functionApp.appSetting',
            virtualPath: key,
            azureResource: resource.azureResource,
        }));
    }

    private async resolveClient(resource: GenericResource): Promise<{ client: IWebAppClient; resourceGroupName: string }> {
        const client = await this.getOrCreateClient(resource);
        const { resourceGroup: resourceGroupName } = parseAzureResourceId(resource.id);
        if (!resourceGroupName) {
            throw new Error(`Cannot extract resource group name from resource ID: ${resource.id}`);
        }
        return { client, resourceGroupName };
    }

    private getOrCreateClient(resource: GenericResource): Promise<IWebAppClient> {
        return this.clientCache.getOrCreate(resource.subscription.subscriptionId, () => this.createClient(resource.subscription));
    }
}

/**
 * Type guard for Function App-owned {@link VirtualResource} nodes.
 */
function isFunctionAppVirtualResource(node: unknown): node is VirtualResource {
    return !!node && typeof node === 'object'
        && isVirtualResource(node as VirtualResource)
        && isFunctionApp((node as VirtualResource).azureResource);
}
