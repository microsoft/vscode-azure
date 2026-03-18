/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription, AzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import {
    isAccount, isResourceGroup, isSubscription, isTenant,
    type ConcreteAzureNode, type IResourceClient
} from '@microsoft/vscode-azure-azutils';
import { InflightMap, type ChildResult, type DataProvider } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureSubscriptionProvider, IResourceClientProvider } from '../../services';

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
    private readonly clientCache = new InflightMap<IResourceClient>(); // TODO: are these clients long-lived enough to warrant caching? Will they break on later calls?

    public constructor(
        @inject(IResourceClientProvider) private readonly createClient: IResourceClientProvider,
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

            case isSubscription(resource): {
                const client = await this.getOrCreateClient(resource);
                return client.resourceGroups.list({ top: DEFAULT_PAGE_SIZE });
            }

            case isResourceGroup(resource): {
                const client = await this.getOrCreateClient(resource.subscription);
                return client.resources.listByResourceGroup(resource.name, { top: DEFAULT_PAGE_SIZE });
            }

            default:
                throw new Error(`Unsupported resource type: ${JSON.stringify(resource)}`);
        }
    }

    /**
     * Get or create a cached REST client for the given subscription.
     * All callers for the same subscription share the same client and pipeline,
     * so {@link DedupeRequestPolicy} can deduplicate concurrent requests.
     */
    private getOrCreateClient(subscription: AzureSubscription): Promise<IResourceClient> {
        return this.clientCache.getOrCreate(subscription.subscriptionId, () => this.createClient(subscription));
    }
}
