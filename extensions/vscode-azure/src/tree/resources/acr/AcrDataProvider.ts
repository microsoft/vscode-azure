/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ContainerRegistryManagementContext, createContainerRegistryManagement } from '@azure/arm-containerregistry/api';
import { get as getRegistries } from '@azure/arm-containerregistry/api/registries';
import { type ConcreteAzureNode, createAzureRestSubscriptionClient, type GenericResource, isVirtualResource, parseAzureResourceId, type VirtualResource } from '@microsoft/vscode-azure-azutils';
import type { DataProvider } from '@microsoft/vscode-azure-utils';
import { IActionExecutor, ICodeContext } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { isAcrRegistry } from './AcrRegistry';

/**
 * Data-layer provider for Azure Container Registries.
 *
 * - **`canHandle`**: matches `GenericResource` nodes whose ARM type is
 *   `Microsoft.ContainerRegistry/registries`.
 * - **`enrich`**: calls the ARM `get` operation to attach
 *   {@link AcrRegistry}-specific properties (`loginServer`, `sku`, etc.)
 *   to the resource in-place.
 * - **`getChildren`**: stubbed — will return repositories and tags once
 *   the data-plane client (`@azure/container-registry`) is integrated.
 */
@injectable()
export class AcrDataProvider implements DataProvider<ConcreteAzureNode> {

    /**
     * Cached ARM management clients per subscription ID, so all calls for
     * the same subscription share one client instance.
     */
    private readonly clientCache = new Map<string, ContainerRegistryManagementContext>();

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
    ) { }

    public canHandle(resource: unknown): resource is ConcreteAzureNode {
        return isAcrRegistry(resource) || isAcrVirtualResource(resource);
    }

    /**
     * Enrich an ACR registry resource with management-plane details.
     *
     * Fetches the full `Registry` via `registries.get()` and assigns
     * `loginServer`, `sku`, and `adminUserEnabled` onto the resource
     * so that view providers can render them without additional API calls.
     */
    public async enrich(resource: ConcreteAzureNode): Promise<boolean> {
        if (!isAcrRegistry(resource)) {
            return false;
        }

        const client = this.getOrCreateClient(resource);
        const { resourceGroup: resourceGroupName } = parseAzureResourceId(resource.id);
        if (!resourceGroupName) {
            throw new Error(`Cannot extract resource group name from resource ID: ${resource.id}`);
        }

        // TODO: remove simulated delay
        await new Promise(resolve => setTimeout(resolve, 5000));

        const registry = await getRegistries(client, resourceGroupName, resource.name);

        Object.assign(resource, {
            loginServer: registry.loginServer ?? '',
            sku: registry.sku,
            adminUserEnabled: registry.adminUserEnabled ?? false,
        });

        return false;
    }

    /**
     * Get children for an ACR registry or virtual sub-node.
     *
     * TODO: replace dummy data with real data-plane calls.
     */
    public getChildren(resource?: ConcreteAzureNode): ConcreteAzureNode[] {
        if (!resource) {
            return [];
        }

        // Registry → category nodes (Repositories, Webhooks)
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
    private getOrCreateClient(resource: GenericResource): ContainerRegistryManagementContext {
        const { subscription } = resource;
        let client = this.clientCache.get(subscription.subscriptionId);
        if (!client) {
            client = createAzureRestSubscriptionClient(this.ctx, this.executor, createContainerRegistryManagement, subscription.credential, subscription.subscriptionId);
            this.clientCache.set(subscription.subscriptionId, client);
        }
        return client;
    }
}

/**
 * Type guard for ACR-owned {@link VirtualResource} nodes.
 */
function isAcrVirtualResource(node: unknown): node is VirtualResource {
    return isVirtualResource(node as VirtualResource)
        && isAcrRegistry((node as VirtualResource).azureResource);
}
