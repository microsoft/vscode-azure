/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    getNodeType, IAcrClientProvider, isVirtualResource, parseAzureResourceId,
    type ConcreteAzureNode, type GenericResource, type IAcrClient, type VirtualResource
} from '@microsoft/vscode-azure-azutils';
import { IActionExecutor, type DataProvider } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { isAcrRegistry } from './AcrRegistry';

/**
 * Data-layer provider for Azure Container Registries.
 *
 * - **`canHandle`**: matches `GenericResource` nodes whose ARM type is
 *   `Microsoft.ContainerRegistry/registries`.
 * - **`enrich`**: calls the ARM `get` operation to attach
 *   {@linkcode AcrRegistry}-specific properties (`loginServer`, `sku`, etc.)
 *   to the resource in-place.
 * - **`getChildren`**: stubbed -- will return repositories and tags once
 *   the data-plane client is integrated.
 *
 * TODO: this is a demonstration provider and needs to be removed
 */
@injectable()
export class AcrDataProvider implements DataProvider<ConcreteAzureNode> {

    /**
     * Cached ARM management clients per subscription ID, so all calls for
     * the same subscription share one client instance.
     */
    private readonly clientCache = new Map<string, IAcrClient>();

    public constructor(
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IAcrClientProvider) private readonly createClient: IAcrClientProvider,
    ) { }

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is ConcreteAzureNode {
        return isAcrRegistry(resource) || isAcrVirtualResource(resource);
    }

    /**
     * @inheritdoc
     *
     * Fetches the full `Registry` via `registries.get()` and assigns
     * `loginServer`, `sku`, and `adminUserEnabled` onto the resource
     * so that view providers can render them without additional API calls.
     *
     * @throws if the resource's ARM ID does not contain a resource group segment.
     */
    public async enrich(resource: ConcreteAzureNode): Promise<boolean> {
        if (!isAcrRegistry(resource)) {
            return false;
        }

        this.executor.setTelProp('nodeType', getNodeType(resource));

        const client = this.getOrCreateClient(resource);
        const { resourceGroup: resourceGroupName } = parseAzureResourceId(resource.id);
        if (!resourceGroupName) {
            throw new Error(`Cannot extract resource group name from resource ID: ${resource.id}`);
        }

        const registry = await client.registries.get(resourceGroupName, resource.name);

        Object.assign(resource, {
            loginServer: registry.loginServer ?? '',
            sku: registry.sku,
            adminUserEnabled: registry.adminUserEnabled ?? false,
        });

        return false;
    }

    /**
     * @inheritdoc
     */
    public getChildren(resource?: ConcreteAzureNode): ConcreteAzureNode[] {
        if (!resource) {
            return [];
        }

        this.executor.setTelProp('nodeType', getNodeType(resource));

        // Registry -> category nodes (Repositories, Webhooks)
        if (isAcrRegistry(resource)) {
            return [
                { virtualType: 'acr.repositories', virtualPath: 'Repositories', azureResource: resource },
                { virtualType: 'acr.webhooks', virtualPath: 'Webhooks', azureResource: resource },
            ];
        }

        // Category node -> dummy leaf items
        if (isVirtualResource(resource) && resource.virtualType === 'acr.repositories') {
            return [
                { virtualType: resource.virtualType, virtualPath: 'repo-1', azureResource: resource.azureResource },
                { virtualType: resource.virtualType, virtualPath: 'repo-2', azureResource: resource.azureResource },
                { virtualType: resource.virtualType, virtualPath: 'repo-3', azureResource: resource.azureResource },
            ];
        }

        if (isVirtualResource(resource) && resource.virtualType === 'acr.webhooks') {
            return [
                { virtualType: resource.virtualType, virtualPath: 'webhook-1', azureResource: resource.azureResource },
                { virtualType: resource.virtualType, virtualPath: 'webhook-2', azureResource: resource.azureResource },
                { virtualType: resource.virtualType, virtualPath: 'webhook-3', azureResource: resource.azureResource },
            ];
        }

        return [];
    }

    /**
     * Get or create a cached ARM management client for the given resource's
     * subscription.
     */
    private getOrCreateClient(resource: GenericResource): IAcrClient {
        let client = this.clientCache.get(resource.subscription.subscriptionId);
        if (!client) {
            client = this.createClient(resource.subscription);
            this.clientCache.set(resource.subscription.subscriptionId, client);
        }
        return client;
    }
}

/**
 * Type guard for ACR-owned {@linkcode VirtualResource} nodes.
 */
function isAcrVirtualResource(node: unknown): node is VirtualResource {
    return !!node && typeof node === 'object'
        && isVirtualResource(node as VirtualResource)
        && isAcrRegistry((node as VirtualResource).azureResource);
}
