/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription, AzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import {
    attachMetadata,
    createAzureClient, createClient, isAccount, isResourceGroup, isSubscription, isTenant, isUnexpected,
    type ConcreteAzureNode, type GenericResource,
    type ResourceClient,
    type ResourceGroup
} from '@microsoft/vscode-azure-azutils';
import type { ChildResult, DataProvider } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import * as util from 'util';
import { IAzureSubscriptionProvider } from '../services';

/**
 * Default page size used when fetching paginated Azure resource lists.
 * Can be overridden via the `azure.pageSize` setting in the future.
 */
const DEFAULT_PAGE_SIZE = 50;

@injectable()
export class GenericAzureDataProvider implements DataProvider<ConcreteAzureNode> {
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

    public canHandle(resource: unknown): resource is ConcreteAzureNode {
        if (!resource || typeof resource !== 'object') {
            return false;
        }

        const node = resource as ConcreteAzureNode;
        return isAccount(node) || isTenant(node) || isSubscription(node) || isResourceGroup(node);
    }

    public async getChildren(resource?: ConcreteAzureNode): Promise<ChildResult<ConcreteAzureNode>> {
        // Ensure sign-in has been initiated (lazy, only once)
        this.signInPromise ??= this.subscriptionProvider.signIn(); // TODO: handle sign out?
        await this.signInPromise;

        if (!resource) {
            // Root: return all signed-in accounts
            return await this.subscriptionProvider.getAccounts() as ConcreteAzureNode[];
        }

        switch (true) {
            case isAccount(resource):
                return await this.subscriptionProvider.getTenantsForAccount(resource);

            case isTenant(resource):
                return await this.subscriptionProvider.getSubscriptionsForTenant(resource);

            case isSubscription(resource):
                return this.getResourceGroupPages(resource);

            case isResourceGroup(resource):
                return this.getResourcePages(resource);

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

    /**
     * Yields pages of resource groups for a subscription.
     */
    private async *getResourceGroupPages(subscription: AzureSubscription): ChildResult<ResourceGroup> {
        const client = await this.getOrCreateClient(subscription);

        const response = await client
            .path('/subscriptions/{subscriptionId}/resourcegroups', subscription.subscriptionId)
            .get({ queryParameters: { $top: DEFAULT_PAGE_SIZE } });

        if (isUnexpected(response)) {
            throw new Error(`Failed to list resource groups: ${response.body.error?.message ?? response.status}`);
        }

        yield (response.body.value ?? [])
            .map(rg => attachMetadata(rg, subscription))
            .map(rg => Object.assign(rg, { groupingStrategy: 'resourceGroup' satisfies ResourceGroup['groupingStrategy'], groupingValue: rg.name })) as ResourceGroup[];

        yield* this.followNextLink<ResourceGroup>(client, response.body.nextLink, subscription);
    }

    /**
     * Yields pages of resources within a resource group.
     */
    private async *getResourcePages(group: ResourceGroup): ChildResult<GenericResource> {
        const client = await this.getOrCreateClient(group.subscription);

        const response = await client
            .path(
                '/subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/resources',
                group.subscription.subscriptionId,
                group.name,
            )
            .get({ queryParameters: { $top: DEFAULT_PAGE_SIZE } });

        if (isUnexpected(response)) {
            throw new Error(`Failed to list resources: ${response.body.error?.message ?? response.status}`);
        }

        yield (response.body.value ?? [])
            .map(r => attachMetadata(r, group.subscription));

        yield* this.followNextLink<GenericResource>(client, response.body.nextLink, group.subscription);
    }

    /**
     * Chase `nextLink` URLs to yield subsequent pages of resources.
     * Azure REST APIs return absolute `nextLink` URLs that include all
     * query parameters needed for the next page.
     */
    private async *followNextLink<T>(
        client: ResourceClient,
        nextLink: string | undefined,
        subscription: AzureSubscription,
    ): AsyncGenerator<T[]> {
        while (nextLink) {
            // pathUnchecked accepts absolute URLs and routes them through
            // the existing pipeline (credentials, dedup policy, etc.)
            const response = await client.pathUnchecked(nextLink).get();

            if (isUnexpected(response)) {
                throw new Error(`Failed to fetch next page: ${response.body.error?.message ?? response.status}`);
            }

            const body = response.body as { value?: Record<string, unknown>[]; nextLink?: string };
            const resources = (body.value ?? [])
                .map(r => attachMetadata(r as Partial<T>, subscription));

            yield resources as T[];
            nextLink = body.nextLink;
        }
    }
}
