/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription, AzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import type { AzureNode, GenericResource, ResourceGroup, VirtualGroup, VirtualResource } from '@microsoft/vscode-azure-azutils';
import { createClient, isAccount, isResourceGroup, isSubscription, isTenant, isUnexpected } from '@microsoft/vscode-azure-azutils';
import type { DataProvider } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import * as util from 'util';
import { IAzureSubscriptionProvider } from '../services';

export type AzureResourceNode = Exclude<AzureNode, VirtualGroup | VirtualResource>;

@injectable()
export class GenericAzureDataProvider implements DataProvider<AzureResourceNode> {
    public readonly isRoot = true;

    public constructor(
        @inject(IAzureSubscriptionProvider) private readonly subscriptionProvider: AzureSubscriptionProvider
    ) { }

    public canHandle(resource: unknown): resource is AzureResourceNode {
        if (!resource || typeof resource !== 'object') {
            return false;
        }

        const node = resource as AzureResourceNode;
        return isAccount(node) || isTenant(node) || isSubscription(node) || isResourceGroup(node);
    }

    public async getChildren(resource?: AzureResourceNode): Promise<AzureResourceNode[]> {
        await this.subscriptionProvider.signIn();
        if (!resource) {
            // Root: return all signed-in accounts
            return await this.subscriptionProvider.getAccounts() as AzureResourceNode[];
        }

        switch (true) {
            case isAccount(resource):
                return await this.subscriptionProvider.getTenantsForAccount(resource);

            case isTenant(resource):
                return await this.subscriptionProvider.getSubscriptionsForTenant(resource);

            case isSubscription(resource):
                return await this.getResourceGroups(resource);

            case isResourceGroup(resource):
                return await this.getResourcesInGroup(resource);

            default:
                throw new Error(`Unsupported resource type: ${util.inspect(resource)}`);
        }
    }

    private async getResourceGroups(subscription: AzureSubscription): Promise<ResourceGroup[]> {
        const client = createClient(subscription.credential);
        const response = await client
            .path('/subscriptions/{subscriptionId}/resourcegroups', subscription.subscriptionId)
            .get();

        if (isUnexpected(response)) {
            throw new Error(`Failed to list resource groups: ${response.body.error?.message ?? response.status}`);
        }

        return (response.body.value ?? [])
            .map(rg => Object.assign(rg, { subscription, groupingStrategy: 'resourceGroup', groupingValue: rg.name } as ResourceGroup));
    }

    private async getResourcesInGroup(group: ResourceGroup): Promise<GenericResource[]> {
        const client = createClient(group.subscription.credential);
        const response = await client
            .path(
                '/subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/resources',
                group.subscription.subscriptionId,
                group.name,
            )
            .get();

        if (isUnexpected(response)) {
            throw new Error(`Failed to list resources: ${response.body.error?.message ?? response.status}`);
        }

        return (response.body.value ?? [])
            .map(r => Object.assign(r, { subscription: group.subscription } as GenericResource));
    }
}
