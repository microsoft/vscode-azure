/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ResourceManagementClient as ResourceClient } from '@azure/arm-resources';
import type { AzureSubscription, AzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import {
    attachMetadata, createAzureSubscriptionClient, isAccount, isResourceGroup, isSubscription, isTenant,
    type ConcreteAzureNode, type GenericResource, type ResourceGroup
} from '@microsoft/vscode-azure-azutils';
import type { ChildResult, DataProvider, Page } from '@microsoft/vscode-azure-utils';
import { IActionExecutor, ICodeContext } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureSubscriptionProvider } from '../services';

let armResources: typeof import('@azure/arm-resources') | undefined;

/**
 * Default page size used when fetching paginated Azure resource lists.
 * TODO: add override setting
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
     * subscription share one pipeline (and thus one {@link DedupeRequestPolicy}).
     */
    private readonly clientCache = new Map<string, ResourceClient>(); // TODO: are these clients long-lived enough to warrant caching? Will they break on later calls?

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
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
                throw new Error(`Unsupported resource type: ${JSON.stringify(resource)}`);
        }
    }

    /**
     * Get or create a cached REST client for the given subscription.
     * All callers for the same subscription share the same client and pipeline,
     * so {@link DedupeRequestPolicy} can deduplicate concurrent requests.
     */
    private async getOrCreateClient(subscription: AzureSubscription): Promise<ResourceClient> {
        let client = this.clientCache.get(subscription.subscriptionId);
        if (!client) {
            armResources ??= await import('@azure/arm-resources');
            client = createAzureSubscriptionClient(this.ctx, this.executor, armResources.ResourceManagementClient, subscription.credential, subscription.subscriptionId);
            this.clientCache.set(subscription.subscriptionId, client);
        }
        return client;
    }

    /**
     * Yields pages of resource groups for a subscription.
     */
    private async *getResourceGroupPages(subscription: AzureSubscription): AsyncIterable<Page<ResourceGroup>> {
        const client = await this.getOrCreateClient(subscription);
        const pages = client.resourceGroups.list({ top: DEFAULT_PAGE_SIZE }).byPage();
        armResources ??= await import('@azure/arm-resources');

        for await (const items of pages) {
            yield {
                items: items.map(rg => {
                    const resource = attachMetadata(rg, subscription);
                    return Object.assign(resource, {
                        groupingStrategy: 'resourceGroup' as const,
                        groupingValue: resource.name,
                    });
                }),
                hasMore: !!armResources.getContinuationToken(items),
            };
        }
    }

    /**
     * Yields pages of resources within a resource group.
     */
    private async *getResourcePages(group: ResourceGroup): AsyncIterable<Page<GenericResource>> {
        const client = await this.getOrCreateClient(group.subscription);
        const pages = client.resources.listByResourceGroup(group.name, { top: DEFAULT_PAGE_SIZE }).byPage();
        armResources ??= await import('@azure/arm-resources');

        for await (const items of pages) {
            yield {
                items: items.map(r => attachMetadata(r, group.subscription)),
                hasMore: !!armResources.getContinuationToken(items),
            };
        }
    }
}
