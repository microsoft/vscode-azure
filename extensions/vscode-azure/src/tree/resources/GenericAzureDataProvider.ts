/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription, AzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import {
    getNodeType, IResourceClientProvider, isAccount, isResourceGroup, isSubscription, isTenant,
    type ConcreteAzureNode, type IResourceClient
} from '@microsoft/vscode-azure-azutils';
import {
    EventEmitter, IActionExecutor, InflightMap, IOutputChannel, IVsCode,
    type ChildResult, type DataProvider, type DataProviderChangeEvent, type Disposable
} from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { ConfigurationSection } from '../../constants';
import { IAzureSubscriptionProvider } from '../../services';

/**
 * Default page size used when fetching paginated Azure resource lists.
 */
const DEFAULT_PAGE_SIZE = 50;

/**
 * Root data-layer provider for the Azure resources tree.
 *
 * Drives the top of the hierarchy -- accounts, tenants, subscriptions, and
 * resource groups -- using the shared {@linkcode AzureSubscriptionProvider}
 * and ARM {@linkcode IResourceClient}. Service-specific providers (e.g.
 * {@linkcode AcrDataProvider}) handle children below the resource group level.
 *
 * Fires {@linkcode onDidChange} when configuration affecting pagination
 * changes, or when the subscription provider suggests a refresh.
 */
@injectable()
export class GenericAzureDataProvider implements DataProvider<ConcreteAzureNode>, Disposable {
    public readonly isRoot = true;

    /**
     * Lazy sign-in: resolved on first call to {@linkcode getChildren}, skipped thereafter.
     */
    private signInPromise: Promise<boolean> | undefined;

    /**
     * Cached REST clients per subscription ID, so all calls for the same
     * subscription share one pipeline (and thus one {@linkcode DedupeRequestPolicy}).
     */
    private readonly clientCache = new InflightMap<IResourceClient>();

    private readonly changeEmitter = new EventEmitter<DataProviderChangeEvent<ConcreteAzureNode>>();
    private readonly disposables: Disposable[] = [this.changeEmitter];

    public readonly onDidChange = this.changeEmitter.event;

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IOutputChannel) private readonly output: IOutputChannel,
        @inject(IResourceClientProvider) private readonly createClient: IResourceClientProvider,
        @inject(IAzureSubscriptionProvider) private readonly subscriptionProvider: AzureSubscriptionProvider
    ) {
        this.disposables.push(code.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(`${ConfigurationSection}.pageSize`)) {
                this.output.debug('[data] resources config changed: pageSize');
                this.changeEmitter.fire({ resource: undefined, includeChildren: true });
            }
        }));

        this.disposables.push(subscriptionProvider.onRefreshSuggested(() => {
            this.output.debug('[data] resources refresh suggested by subscription provider');
            this.signInPromise = undefined;
            this.changeEmitter.fire({ resource: undefined, includeChildren: true });
        }));
    }

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is ConcreteAzureNode {
        if (!resource || typeof resource !== 'object') {
            return false;
        }

        const node = resource as ConcreteAzureNode;
        return isAccount(node) || isTenant(node) || isSubscription(node) || isResourceGroup(node);
    }

    /**
     * @inheritdoc
     * @throws if `resource` is not an account, tenant, subscription, or resource group.
     */
    public async getChildren(resource?: ConcreteAzureNode): Promise<ChildResult<ConcreteAzureNode>> {
        // Ensure sign-in has been initiated (lazy, only once)
        if (!this.signInPromise) {
            this.output.debug('[auth] lazy sign-in start');
            this.signInPromise = this.subscriptionProvider.signIn();
        }
        await this.signInPromise;

        if (resource) {
            this.executor.setTelProp('nodeType', getNodeType(resource));
        }

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
                this.output.debug(`[data] discover resource groups subscription=${resource.subscriptionId} pageSize=${this.pageSize}`);
                return client.resourceGroups.list({ top: this.pageSize });
            }

            case isResourceGroup(resource): {
                const client = await this.getOrCreateClient(resource.subscription);
                this.output.debug(`[data] discover resources resourceGroup=${resource.subscription.subscriptionId}/${resource.name} pageSize=${this.pageSize}`);
                return client.resources.listByResourceGroup(resource.name, { top: this.pageSize });
            }

            default:
                throw new Error(`Unsupported resource type: ${JSON.stringify(resource)}`);
        }
    }

    /**
     * Get or create a cached REST client for the given subscription.
     * All callers for the same subscription share the same client and pipeline,
     * so {@linkcode DedupeRequestPolicy} can deduplicate concurrent requests.
     */
    private getOrCreateClient(subscription: AzureSubscription): Promise<IResourceClient> {
        return this.clientCache.getOrCreate(subscription.subscriptionId, () => this.createClient(subscription));
    }

    private get pageSize(): number {
        return this.code.workspace.getConfiguration(ConfigurationSection).get('pageSize', DEFAULT_PAGE_SIZE);
    }

    /** @inheritdoc */
    public dispose(): void {
        this.disposables.forEach(d => void d.dispose());
    }
}
