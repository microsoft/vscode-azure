/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    getNodeType,
    isVirtualResource,
    IWebAppClientProvider,
    parseAzureResourceId,
    type ConcreteAzureNode, type GenericResource, type IWebAppClient, type VirtualResource
} from '@microsoft/vscode-azure-azutils';
import { IActionExecutor, type DataProvider } from '@microsoft/vscode-azure-utils';
import { inject, injectable, type ServiceIdentifier } from 'inversify';
import { AppSettingsModel, type IAppSettingsClient } from '../appSettings/AppSettingsModel';
import { FunctionAppVirtualPaths, FunctionAppVirtualTypes, isFunctionApp } from './FunctionApp';

export const IFunctionAppDataProvider: ServiceIdentifier<DataProvider<ConcreteAzureNode>> = Symbol.for('IFunctionAppDataProvider');
export type IFunctionAppDataProvider = FunctionAppDataProvider;

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

    private readonly clientCache = new Map<string, IWebAppClient>();

    private readonly appSettings: AppSettingsModel<GenericResource>;

    public constructor(
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IWebAppClientProvider) private readonly createClient: IWebAppClientProvider,
    ) {
        this.appSettings = new AppSettingsModel(
            resource => resource.id,
            resource => this.createAppSettingsClient(resource),
        );
    }

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is ConcreteAzureNode {
        return isFunctionApp(resource) || isFunctionAppVirtualResource(resource);
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
        return this.appSettings.getValueByParentKey(resourceId, settingKey);
    }

    /**
     * Add or update an app setting. Merges into the remote settings and
     * refreshes the local cache.
     *
     * @throws if the resource's ARM ID does not contain a resource group segment.
     */
    public async addOrUpdateSetting(resource: GenericResource, key: string, value: string): Promise<void> {
        await this.appSettings.addOrUpdate(resource, key, value);
    }

    /**
     * Delete an app setting by key.
     *
     * @throws if the resource's ARM ID does not contain a resource group segment.
     */
    public async deleteSetting(resource: GenericResource, key: string): Promise<void> {
        await this.appSettings.delete(resource, key);
    }

    private async listAppSettings(resource: VirtualResource): Promise<ConcreteAzureNode[]> {
        const keys = await this.appSettings.list(resource.azureResource);
        return keys.map(key => ({
            virtualType: FunctionAppVirtualTypes.AppSetting,
            virtualPath: key,
            azureResource: resource.azureResource,
        }));
    }

    private createAppSettingsClient(resource: GenericResource): IAppSettingsClient {
        const { client, resourceGroupName } = this.resolveClient(resource);
        return {
            list: async () => {
                const result = await client.webApps.listApplicationSettings(resourceGroupName, resource.name);
                return { ...result.properties };
            },
            update: async settings => {
                const result = await client.webApps.updateApplicationSettings(resourceGroupName, resource.name, { properties: settings });
                return { ...result.properties };
            },
        };
    }

    private resolveClient(resource: GenericResource): { client: IWebAppClient; resourceGroupName: string } {
        const client = this.getOrCreateClient(resource);
        const { resourceGroup: resourceGroupName } = parseAzureResourceId(resource.id);
        if (!resourceGroupName) {
            throw new Error(`Cannot extract resource group name from resource ID: ${resource.id}`);
        }
        return { client, resourceGroupName };
    }

    private getOrCreateClient(resource: GenericResource): IWebAppClient {
        let client = this.clientCache.get(resource.subscription.subscriptionId);
        if (!client) {
            client = this.createClient(resource.subscription);
            this.clientCache.set(resource.subscription.subscriptionId, client);
        }
        return client;
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
