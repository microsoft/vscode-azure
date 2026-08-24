/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    getNodeType, getResourceGroupName, IAcrClientProvider, isVirtualResource,
    type ConcreteAzureNode, type VirtualResource
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
 * @remarks This is demonstration code; removal is tracked by
 * {@link https://github.com/microsoft/vscode-azure/issues/177}.
 */
@injectable()
export class AcrDataProvider implements DataProvider<ConcreteAzureNode> {
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

        const client = this.createClient(resource.subscription);
        const resourceGroupName = getResourceGroupName(resource.id);

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
}

/**
 * Type guard for ACR-owned {@linkcode VirtualResource} nodes.
 */
function isAcrVirtualResource(node: unknown): node is VirtualResource {
    return !!node && typeof node === 'object'
        && isVirtualResource(node as VirtualResource)
        && isAcrRegistry((node as VirtualResource).azureResource);
}
