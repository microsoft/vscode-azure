/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    getResourceGroupName,
    getNodeType,
    isVirtualResource,
    IWebAppClientProvider,
    type ConcreteAzureNode, type GenericResource, type IWebAppClient, type VirtualResource
} from '@microsoft/vscode-azure-azutils';
import { CaselessMap, IActionExecutor, type DataProvider } from '@microsoft/vscode-azure-utils';
import { inject, injectable, type ServiceIdentifier } from 'inversify';
import { setWebsiteUrl } from '../websiteUrl';
import { FunctionAppVirtualPaths, FunctionAppVirtualTypes, isFunctionApp } from './FunctionApp';

export const IFunctionAppDataProvider: ServiceIdentifier<DataProvider<ConcreteAzureNode>> = Symbol.for('IFunctionAppDataProvider');
export type IFunctionAppDataProvider = FunctionAppDataProvider;

/**
 * Data-layer provider for Azure Function Apps.
 *
 * - **`canHandle`**: matches Function App resources and their virtual children
 * - **`enrich`**: attaches the app's website URL to the resource
 * - **`getChildren`**: returns virtual category nodes (App Settings) and
 *   individual app setting leaf nodes fetched from the ARM API
 *
 * Caches app settings per Function App so that CRUD commands can read/write
 * values without re-fetching. The cache is invalidated after mutations.
 */
@injectable()
export class FunctionAppDataProvider implements DataProvider<ConcreteAzureNode> {
    /**
     * In-memory cache of app settings keyed by ARM resource ID.
     * Populated when listing children, used by CRUD commands to
     * avoid redundant API calls.
     */
    private readonly settingsCache = new CaselessMap<Record<string, string>>();

    public constructor(
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IWebAppClientProvider) private readonly createClient: IWebAppClientProvider,
    ) { }

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is ConcreteAzureNode {
        return isFunctionApp(resource) || isFunctionAppVirtualResource(resource);
    }

    /**
     * @inheritdoc
     *
     * Attaches the Function App's public website URL so the Browse Website
     * command becomes available on the node.
     *
     * @throws if the resource's ARM ID does not contain a resource group segment.
     */
    public async enrich(resource: ConcreteAzureNode): Promise<boolean> {
        if (!isFunctionApp(resource)) {
            return false;
        }

        this.executor.setTelProp('nodeType', getNodeType(resource));

        const { client, resourceGroupName } = this.resolveClient(resource);
        setWebsiteUrl(resource, (await client.webApps.get(resourceGroupName, resource.name)).defaultHostName);

        return false;
    }

    /** @inheritdoc */
    public async getChildren(resource?: ConcreteAzureNode): Promise<ConcreteAzureNode[]> {
        if (!resource) {
            return [];
        }

        this.executor.setTelProp('nodeType', getNodeType(resource));

        // Function App -> category nodes
        if (isFunctionApp(resource)) {
            return [
                { virtualType: FunctionAppVirtualTypes.AppSettings, virtualPath: FunctionAppVirtualPaths.AppSettings, azureResource: resource },
            ];
        }

        // App Settings category -> individual settings
        if (isVirtualResource(resource) && resource.virtualType === FunctionAppVirtualTypes.AppSettings) {
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
     * Add or update an app setting. Merges into the remote settings and
     * refreshes the local cache.
     *
     * @throws if the resource's ARM ID does not contain a resource group segment.
     */
    public async addOrUpdateSetting(resource: GenericResource, key: string, value: string): Promise<void> {
        const { client, resourceGroupName } = this.resolveClient(resource);

        const current = await client.webApps.listApplicationSettings(resourceGroupName, resource.name);
        const properties = { ...current.properties, [key]: value };
        await client.webApps.updateApplicationSettings(resourceGroupName, resource.name, { ...current, properties });

        // Update local cache
        this.settingsCache.set(resource.id, properties);
    }

    /**
     * Delete an app setting by key.
     *
     * @throws if the resource's ARM ID does not contain a resource group segment.
     */
    public async deleteSetting(resource: GenericResource, key: string): Promise<void> {
        const { client, resourceGroupName } = this.resolveClient(resource);

        const current = await client.webApps.listApplicationSettings(resourceGroupName, resource.name);
        const remaining = Object.fromEntries(
            Object.entries({ ...current.properties }).filter(([k]) => k !== key)
        );
        await client.webApps.updateApplicationSettings(resourceGroupName, resource.name, { ...current, properties: remaining });

        // Update local cache
        this.settingsCache.set(resource.id, remaining);
    }

    private async listAppSettings(resource: VirtualResource): Promise<ConcreteAzureNode[]> {
        const { client, resourceGroupName } = this.resolveClient(resource.azureResource);

        const settings = await client.webApps.listApplicationSettings(resourceGroupName, resource.azureResource.name);
        const properties = settings.properties ?? {};

        // Cache the full settings map
        this.settingsCache.set(resource.azureResource.id, { ...properties });

        return Object.keys(properties).sort().map(key => ({
            virtualType: FunctionAppVirtualTypes.AppSetting,
            virtualPath: key,
            azureResource: resource.azureResource,
        }));
    }

    private resolveClient(resource: GenericResource): { client: IWebAppClient; resourceGroupName: string } {
        return {
            client: this.createClient(resource.subscription),
            resourceGroupName: getResourceGroupName(resource.id),
        };
    }
}

/**
 * Type guard for Function App-owned {@linkcode VirtualResource} nodes.
 */
function isFunctionAppVirtualResource(node: unknown): node is VirtualResource {
    return !!node && typeof node === 'object'
        && isVirtualResource(node as VirtualResource)
        && isFunctionApp((node as VirtualResource).azureResource);
}
