/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import type { AzureNode, GenericResource, VirtualGroup } from '@microsoft/vscode-azure-azutils';
import { AzureNodeId, isAccount, isGenericResource, isResourceGroup, isSubscription, isTenant } from '@microsoft/vscode-azure-azutils';
import type { ResourceTree, ViewProvider } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import * as vscode from 'vscode';
import { IAzureResourceTreeCache } from '../services';
import type { AzureResourceNode } from './GenericAzureDataProvider';

export type GroupingStrategy = 'resourceGroup' | 'resourceType' | 'location';

@injectable()
export class GenericAzureViewProvider implements ViewProvider<string> {
    public readonly isRoot = true;

    /**
     * Current grouping strategy for resources under subscriptions.
     * Defaults to `'resourceGroup'` (mirrors the ARM hierarchy directly).
     * TODO: make configurable
     */
    private readonly groupingStrategy: GroupingStrategy = 'resourceGroup';

    public constructor(
        @inject(IAzureResourceTreeCache) private readonly cache: ResourceTree<AzureResourceNode>,
    ) { }

    // #region ViewProvider

    public canHandle(resource: unknown): resource is string {
        // TODO: need to not try to handle things below `GenericResource` level
        return typeof resource === 'string' && AzureNodeId.test(resource);
    }

    public async getChildren(resource?: string): Promise<string[]> {
        if (resource === undefined) {
            return this.getRootChildren();
        }

        return this.getBranchChildren(resource);
    }

    public getTreeItem(key: string): vscode.TreeItem {
        const nodeId = AzureNodeId.parse(key);

        if (nodeId.isVirtualGroupNodeId()) {
            const label = decodeGroupingValue(key);
            const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
            item.id = key;
            item.contextValue = 'azureVirtualGroup';
            item.iconPath = new vscode.ThemeIcon('symbol-namespace');
            return item;
        }

        const resource = this.cache.get(key);
        if (!resource) {
            return new vscode.TreeItem(key); // TODO: throw?
        }

        switch (true) {
            case isAccount(resource): {
                const item = new vscode.TreeItem(resource.label, vscode.TreeItemCollapsibleState.Collapsed);
                item.id = key;
                item.contextValue = 'azureAccount';
                item.iconPath = new vscode.ThemeIcon('account');
                return item;
            }

            case isTenant(resource): {
                const label = resource.displayName ?? resource.tenantId;
                const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
                item.id = key;
                item.contextValue = 'azureTenant';
                item.iconPath = new vscode.ThemeIcon('organization');
                return item;
            }

            case isSubscription(resource): {
                const item = new vscode.TreeItem(resource.name, vscode.TreeItemCollapsibleState.Collapsed);
                item.id = key;
                item.contextValue = 'azureSubscription';
                item.iconPath = new vscode.ThemeIcon('key');
                return item;
            }

            case isResourceGroup(resource): {
                const item = new vscode.TreeItem(resource.name, vscode.TreeItemCollapsibleState.Collapsed);
                item.id = key;
                item.contextValue = 'azureResourceGroup';
                item.iconPath = new vscode.ThemeIcon('archive');
                return item;
            }

            case isGenericResource(resource): {
                const item = new vscode.TreeItem(resource.name, vscode.TreeItemCollapsibleState.None);
                item.id = key;
                item.description = resource.type;
                item.contextValue = 'azureResource';
                item.iconPath = new vscode.ThemeIcon('symbol-misc');
                return item;
            }

            default: {
                return new vscode.TreeItem(key);
            }
        }
    }

    // #endregion

    // #region Children helpers

    /**
     * Get root children, automatically skipping the account level when
     * there is exactly one account, and the tenant level when there is
     * exactly one tenant.
     */
    private async getRootChildren(): Promise<string[]> {
        let nodes = await this.cache.getChildren(undefined);

        if (nodes.length === 1 && isAccount(nodes[0])) {
            nodes = await this.cache.getChildren(nodes[0]);
        }

        if (nodes.length === 1 && isTenant(nodes[0])) {
            nodes = await this.cache.getChildren(nodes[0]);
        }

        return nodes.map(toKey);
    }

    private async getBranchChildren(key: string): Promise<string[]> {
        const nodeId = AzureNodeId.parse(key);

        // Subscription: group its resources according to the current strategy
        if (nodeId.isSubscriptionNodeId()) {
            const subscription = this.cache.get(key);
            if (!subscription || !isSubscription(subscription)) {
                return [];
            }
            const groups = await this.groupResources(subscription);
            return [...groups.keys()].sort();
        }

        // Virtual group: find the matching bucket from the parent subscription
        if (nodeId.isVirtualGroupNodeId()) {
            const subscriptionKey = extractSubscriptionKey(key);
            const subscription = this.cache.get(subscriptionKey);
            if (!subscription || !isSubscription(subscription)) {
                return [];
            }
            const groups = await this.groupResources(subscription);
            return groups.get(key) ?? [];
        }

        // Everything else: straight cache passthrough
        const resource = this.cache.get(key);
        if (!resource) {
            return [];
        } else {
            return (await this.cache.getChildren(resource)).map(toKey);
        }
    }

    /**
     * Group all resources under a subscription according to
     * {@link groupingStrategy}.
     *
     * Returns a `Map` from group key to an array of resource keys.
     * For `'resourceGroup'` strategy the groups are the resource groups
     * themselves (each with its own children in the cache).
     * For other strategies the groups are virtual, keyed by grouping value.
     */
    private async groupResources(subscription: AzureSubscription): Promise<Map<string, string[]>> {
        const resourceGroups = await this.cache.getChildren(subscription as AzureResourceNode);

        // Resource group strategy: one group per RG, children resolved by
        // the cache on the next expansion -- no flattening needed.
        if (this.groupingStrategy === 'resourceGroup') {
            const groups = new Map<string, string[]>();
            for (const rg of resourceGroups) {
                groups.set(toKey(rg), []);
            }
            return groups;
        }

        // Other strategies: flatten all resources across RGs, then bucket.
        // TODO: concurrency limits
        const allResources = (
            await Promise.all(resourceGroups.map(rg => this.cache.getChildren(rg)))
        ).flat().filter((r): r is GenericResource => isGenericResource(r) && !isResourceGroup(r));

        const groups = new Map<string, string[]>();
        for (const resource of allResources) {
            const value = groupingValue(this.groupingStrategy, resource);
            const group: VirtualGroup = {
                subscription,
                groupingStrategy: this.groupingStrategy,
                groupingValue: value,
            };
            const groupKey = toKey(group);

            let bucket = groups.get(groupKey);
            if (!bucket) {
                bucket = [];
                groups.set(groupKey, bucket);
            }
            bucket.push(toKey(resource));
        }

        return groups;
    }

    // #endregion
}

/**
 * Extract the grouping value from a virtual group key by decoding the
 * last segment — e.g. `azr://...subscriptions/subId/~resourceType/Microsoft.Web%2Fsites`
 * → `'Microsoft.Web/sites'`.
 */
function decodeGroupingValue(key: string): string {
    return decodeURIComponent(key.slice(key.lastIndexOf('/') + 1));
}

/**
 * Extract the subscription key from a virtual group key by truncating
 * at the `/~` segment — e.g.
 * `azr://...subscriptions/subId/~resourceType/value` → `azr://...subscriptions/subId`.
 */
function extractSubscriptionKey(key: string): string {
    const tildeIndex = key.indexOf('/~');
    return tildeIndex === -1 ? key : key.slice(0, tildeIndex);
}

/**
 * Derive the grouping value for a resource given a strategy.
 */
function groupingValue(strategy: GroupingStrategy, resource: GenericResource): string {
    switch (strategy) {
        case 'resourceType':
            return resource.type;
        case 'location':
            return resource.location;
        default:
            return resource.type;
    }
}

// TODO: can we eliminate this? Make the providers all return `AzureNodeId`?
function toKey(node: AzureNode): string {
    return AzureNodeId.from(node).toString();
}
