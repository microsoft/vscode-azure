/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription, AzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import type { AzureNode, GenericResource, ResourceGroup, VirtualGroup, VirtualResource } from '@microsoft/vscode-azure-azutils';
import { createAzureClient, createClient, isAccount, isResourceGroup, isSubscription, isTenant, isUnexpected, type ResourceClient } from '@microsoft/vscode-azure-azutils';
import type { DataProvider } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import * as util from 'util';
import { IAzureSubscriptionProvider } from '../services';

export type AzureResourceNode = Exclude<AzureNode, VirtualGroup | VirtualResource>;

@injectable()
export class GenericAzureDataProvider implements DataProvider<AzureResourceNode> {
    public readonly isRoot = true;

    /**
     * Lazy sign-in: resolved on first call to {@link getChildren}, skipped thereafter.
     */
    private signInPromise: Promise<boolean> | undefined;

    /**
     * Cached REST clients per subscription ID, so all calls for the same
     * subscription share one pipeline (and thus one {@link DedupeRequestPipelinePolicy}).
     */
    private readonly clientCache = new Map<string, ResourceClient>(); // TODO: are these clients long-lived enough to warrant caching? Will they break on later calls?

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
        this.signInPromise ??= this.subscriptionProvider.signIn(); // TODO: handle sign out?
        await this.signInPromise;

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

    /**
     * Get or create a cached REST client for the given subscription.
     * All callers for the same subscription share the same client and pipeline,
     * so {@link DedupeRequestPipelinePolicy} can deduplicate concurrent requests.
     */
    private async getOrCreateClient(subscription: AzureSubscription): Promise<ResourceClient> {
        let client = this.clientCache.get(subscription.subscriptionId);
        if (!client) {
            client = await createAzureClient(
                opts => createClient(subscription.credential, opts),
            );
            this.clientCache.set(subscription.subscriptionId, client);
        }
        return client;
    }

    private async getResourceGroups(subscription: AzureSubscription): Promise<ResourceGroup[]> {
        const client = await this.getOrCreateClient(subscription);
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
        // TODO: switch to the subscription-level `/subscriptions/{id}/resources` endpoint
        // and use DedupeRequestPipelinePolicy to collapse parallel per-RG calls into a
        // single HTTP request per subscription.
        const client = await this.getOrCreateClient(group.subscription);
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
