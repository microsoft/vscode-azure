/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import type { AzureNode, ConcreteAzureNode, GenericResource, GroupingStrategy, VirtualGroup } from '@microsoft/vscode-azure-azutils';
import { AzureNodeId, isAccount, isGenericResource, isResourceGroup, isSubscription, isTenant } from '@microsoft/vscode-azure-azutils';
import type { ITreeItem, ViewProvider } from '@microsoft/vscode-azure-utils';
import { IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { OpenInPortal } from '../../commands/OpenInPortal';
import { IAzureViewDataTree } from '../../services';
import { combineContextValues } from '../combineContextValues';

@injectable()
export class GenericAzureViewProvider implements ViewProvider<string> {
    public readonly isRoot = true;

    /**
     * Current grouping strategy for resources under subscriptions.
     * Defaults to `'resourceGroup'` (mirrors the ARM hierarchy directly).
     * TODO: make configurable
     */
    private readonly groupingStrategy: GroupingStrategy = 'resourceGroup';

    /**
     * Tracks which hierarchy level the tree roots actually start at,
     * after account/tenant skipping in {@link getRootChildren}.
     * Used by {@link getParent} to return `undefined` for effective roots.
     *
     * **Note:** This is only set after {@link getRootChildren} runs. If
     * `TreeView.reveal()` is called before the tree has loaded, `getParent`
     * will use the default `'subscription'` value, which may be incorrect and
     * cause reveal to fail for nodes below skipped levels.
     *
     * `'subscription'` is chosen as the default since the majority of users
     * have only one account and one tenant, so skipping both levels is common
     */
    private rootKind: 'account' | 'tenant' | 'subscription' = 'subscription';
    private isOneRootSub = false;

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IAzureViewDataTree) private readonly cache: IAzureViewDataTree,
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

    public getTreeItem(key: string): ITreeItem {
        const nodeId = AzureNodeId.parse(key);

        if (nodeId.isVirtualGroupNodeId()) {
            const grouping = nodeId.getGrouping();
            const label = grouping?.groupingValue ?? key;
            const item = new this.code.TreeItem(label, this.code.TreeItemCollapsibleState.Collapsed);
            item.id = key;
            item.iconPath = new this.code.ThemeIcon('symbol-namespace');
            return item;
        }

        const resource = this.cache.get(key);
        if (!resource) {
            return new this.code.TreeItem(key); // TODO: throw?
        }

        switch (true) {
            case isAccount(resource): {
                const item = new this.code.TreeItem(resource.label, this.code.TreeItemCollapsibleState.Collapsed);
                item.id = key;
                item.iconPath = new this.code.ThemeIcon('account');
                return item;
            }

            case isTenant(resource): {
                const label = resource.displayName ?? resource.tenantId;
                const item = new this.code.TreeItem(label, this.code.TreeItemCollapsibleState.Collapsed);
                item.id = key;
                item.iconPath = new this.code.ThemeIcon('organization');
                return item;
            }

            case isSubscription(resource): {
                const item = new this.code.TreeItem(resource.name, this.isOneRootSub ? this.code.TreeItemCollapsibleState.Expanded : this.code.TreeItemCollapsibleState.Collapsed);
                item.id = key;
                item.contextValue = combineContextValues(OpenInPortal.ContextValue);
                item.iconPath = new this.code.ThemeIcon('key');
                return item;
            }

            case isResourceGroup(resource): {
                const item = new this.code.TreeItem(resource.name, this.code.TreeItemCollapsibleState.Collapsed);
                item.id = key;
                item.contextValue = combineContextValues(OpenInPortal.ContextValue);
                item.iconPath = new this.code.ThemeIcon('archive');
                return item;
            }

            case isGenericResource(resource): {
                const item = new this.code.TreeItem(resource.name, this.code.TreeItemCollapsibleState.None);
                item.id = key;
                item.description = resource.logicalType;
                item.contextValue = combineContextValues(OpenInPortal.ContextValue);
                item.iconPath = new this.code.ThemeIcon('symbol-misc');
                return item;
            }

            default: {
                return new this.code.TreeItem(key);
            }
        }
    }

    /**
     * Returns the parent key for a given tree node.
     *
     * **Important:** This method is intended for VS Code's internal tree
     * navigation (e.g., `TreeView.reveal()`). Application code should use
     * {@link AzureNodeId.parentNodeId} directly, if needed.
     *
     * **Limitation:** Reveal is best-effort. If `TreeView.reveal()` is
     * called before the tree has ever loaded roots (before
     * {@link getRootChildren} runs), `rootKind` will still be `'subscription'`
     * and this method may return parent keys for account/tenant nodes that
     * are actually skipped from the visible tree. This can cause reveal to
     * fail until the user has expanded the tree at least once.
     *
     * We cannot fix this without making `getParent` async to find out if we
     * will be skipping, which would be prohibitively slow. If this becomes
     * a problem, we could make this async and just call
     * `this.getChildren(undefined)` before the rest.
     */
    public getParent(key: string): string | undefined {
        const nodeId = AzureNodeId.parse(key);

        // For generic resources under a non-resourceGroup grouping strategy,
        // the parent is a virtual group node -- not the ARM resource group.
        // We must construct the correct virtual group key from the resource.
        if (nodeId.isGenericResourceNodeId() && this.groupingStrategy !== 'resourceGroup') {
            const resource = this.cache.get(key);
            if (resource && isGenericResource(resource)) {
                const value = groupingValue(this.groupingStrategy, resource);
                const group: VirtualGroup = {
                    subscription: resource.subscription,
                    groupingStrategy: this.groupingStrategy satisfies VirtualGroup['groupingStrategy'],
                    groupingValue: value,
                };
                return toKey(group);
            }
        }

        const parentNodeId = nodeId.parentNodeId();
        if (parentNodeId === undefined) {
            return undefined;
        }

        // If the parent falls above the effective root level (because
        // account/tenant were skipped), this node is a root -- return
        // `undefined` so VS Code knows to stop walking up.
        if (this.rootKind === 'subscription') {
            if (parentNodeId.isAccountNodeId() || parentNodeId.isTenantNodeId()) {
                return undefined;
            }
        } else if (this.rootKind === 'tenant') {
            if (parentNodeId.isAccountNodeId()) {
                return undefined;
            }
        }

        return parentNodeId.toString();
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
        this.rootKind = 'account';
        this.isOneRootSub = false;

        if (nodes.length === 1 && isAccount(nodes[0])) {
            nodes = await this.cache.getChildren(nodes[0]);
            this.rootKind = 'tenant';
        }

        if (nodes.length === 1 && isTenant(nodes[0])) {
            nodes = await this.cache.getChildren(nodes[0]);
            this.rootKind = 'subscription';

            if (nodes.length === 1) {
                this.isOneRootSub = true;
            }
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
            const subscriptionKey = nodeId.parentNodeId()?.toString();
            const subscription = subscriptionKey ? this.cache.get(subscriptionKey) : undefined;
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
        const sub = subscription as ConcreteAzureNode;

        // Resource group strategy: one group per RG, children resolved by
        // the cache on the next expansion -- no flattening needed.
        if (this.groupingStrategy === 'resourceGroup') {
            const resourceGroups = await this.cache.getChildren(sub);
            const groups = new Map<string, string[]>();
            for (const rg of resourceGroups) {
                groups.set(toKey(rg), []);
            }
            return groups;
        }

        // Other strategies: load ALL resource groups and ALL resources
        // (exhausting pagination) so the complete set can be bucketed.
        await this.cache.loadAll(sub);
        const resourceGroups = await this.cache.getChildren(sub);

        // TODO: concurrency limits
        await Promise.all(resourceGroups.map(rg => this.cache.loadAll(rg)));

        const allResources = (
            await Promise.all(resourceGroups.map(rg => this.cache.getChildren(rg)))
        ).flat().filter((r): r is GenericResource => isGenericResource(r) && !isResourceGroup(r));

        const groups = new Map<string, string[]>();
        for (const resource of allResources) {
            const value = groupingValue(this.groupingStrategy, resource);
            const group: VirtualGroup = {
                subscription,
                groupingStrategy: this.groupingStrategy satisfies VirtualGroup['groupingStrategy'],
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
 * Derive the grouping value for a resource given a strategy.
 */
function groupingValue(strategy: GroupingStrategy, resource: GenericResource): string {
    switch (strategy) {
        case 'resourceType':
            return resource.logicalType;
        case 'location':
            return resource.location;
        // TODO: armTag
        default:
            return resource.logicalType;
    }
}

// TODO: can we eliminate this? Make the providers all return `AzureNodeId`?
function toKey(node: AzureNode): string {
    return AzureNodeId.from(node).toString();
}
