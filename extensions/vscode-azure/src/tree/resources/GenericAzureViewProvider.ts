/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import type { AzureNode, ConcreteAzureNode, GenericResource, GroupingStrategy, VirtualGroup } from '@microsoft/vscode-azure-azutils';
import { AzureNodeId, getNodeType, isAccount, isGenericResource, isResourceGroup, isSubscription, isTenant, SubscriptionArmType } from '@microsoft/vscode-azure-azutils';
import type { ITreeItem, ViewProvider } from '@microsoft/vscode-azure-utils';
import { EventEmitter, IActionExecutor, IVsCode, type DataProviderChangeEvent, type Disposable } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { OpenInPortal } from '../../commands/OpenInPortal';
import { ConfigurationSection } from '../../constants';
import { IAzureViewDataTree } from '../../services';
import { combineContextValues } from '../combineContextValues';

/**
 * Root view-layer provider for the Azure resources tree.
 *
 * Renders accounts, tenants, subscriptions, resource groups, generic
 * resources, and virtual grouping nodes (when grouping by resource type,
 * location, or tag). Automatically collapses the hierarchy when there is
 * a single account and/or tenant.
 */
@injectable()
export class GenericAzureViewProvider implements ViewProvider<string>, Disposable {
    public readonly isRoot = true;

    /**
     * Tracks which hierarchy level the tree roots actually start at,
     * after account/tenant skipping in {@linkcode getRootChildren}.
     * Used by {@linkcode getParent} to return `undefined` for effective roots.
     *
     * **Note:** This is only set after {@linkcode getRootChildren} runs. If
     * `TreeView.reveal()` is called before the tree has loaded, `getParent`
     * will use the default `'subscription'` value, which may be incorrect and
     * cause reveal to fail for nodes below skipped levels.
     *
     * `'subscription'` is chosen as the default since the majority of users
     * have only one account and one tenant, so skipping both levels is common
     */
    private rootKind: 'account' | 'tenant' | 'subscription' = 'subscription';
    private isOneRootSub = false;

    private readonly changeEmitter = new EventEmitter<DataProviderChangeEvent<string>>();
    private readonly disposables: Disposable[] = [this.changeEmitter];

    public readonly onDidChange = this.changeEmitter.event;

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IAzureViewDataTree) private readonly cache: IAzureViewDataTree,
    ) {
        this.disposables.push(code.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(`${ConfigurationSection}.alwaysShowAccountNodes`)
                || e.affectsConfiguration(`${ConfigurationSection}.groupBy`)
                || e.affectsConfiguration(`${ConfigurationSection}.groupByTag`)) {
                this.changeEmitter.fire({ resource: undefined, includeChildren: true });
            }
        }));
    }

    // #region ViewProvider

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is string {
        // TODO: need to not try to handle things below `GenericResource` level
        return typeof resource === 'string' && AzureNodeId.test(resource);
    }

    /** @inheritdoc */
    public async getChildren(resource?: string): Promise<string[]> {
        if (resource === undefined) {
            return this.getRootChildren();
        }

        return this.getBranchChildren(resource);
    }

    /** @inheritdoc */
    public getTreeItem(key: string): ITreeItem {
        const nodeId = AzureNodeId.parse(key);

        if (nodeId.isVirtualGroupNodeId()) {
            this.executor.setTelProp('nodeType', virtualGroupNodeType);
            const grouping = nodeId.getGrouping();
            const label = grouping?.groupingValue === untaggedSentinel
                ? this.code.l10n.t('(No Tag)')
                : grouping?.groupingValue ?? key;
            const item = new this.code.TreeItem(label, this.code.TreeItemCollapsibleState.Collapsed);
            item.id = key;
            item.iconPath = new this.code.ThemeIcon('symbol-namespace');
            return item;
        }

        const resource = this.cache.get(key);
        if (!resource) {
            return new this.code.TreeItem(key); // TODO: throw?
        }

        this.executor.setTelProp('nodeType', getNodeType(resource));

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
     * {@linkcode AzureNodeId.parentNodeId} directly, if needed.
     *
     * **Limitation:** Reveal is best-effort. If `TreeView.reveal()` is
     * called before the tree has ever loaded roots (before
     * {@linkcode getRootChildren} runs), `rootKind` will still be `'subscription'`
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
                const group: VirtualGroup = {
                    subscription: resource.subscription,
                    groupingStrategy: this.groupingStrategy satisfies VirtualGroup['groupingStrategy'],
                    groupingValue: this.groupingValue(resource),
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

        const skip = !this.code.workspace.getConfiguration(ConfigurationSection).get<boolean>('alwaysShowAccountNodes', false);

        if (skip && nodes.length === 1 && isAccount(nodes[0])) {
            nodes = await this.cache.getChildren(nodes[0]);
            this.rootKind = 'tenant';
        }

        if (skip && nodes.length === 1 && isTenant(nodes[0])) {
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
            this.executor.setTelProp('nodeType', SubscriptionArmType);
            const subscription = this.cache.get(key);
            if (!subscription || !isSubscription(subscription)) {
                return [];
            }
            const groups = await this.groupResources(subscription);
            return [...groups.keys()].sort();
        }

        // Virtual group: find the matching bucket from the parent subscription
        if (nodeId.isVirtualGroupNodeId()) {
            this.executor.setTelProp('nodeType', virtualGroupNodeType);
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
            this.executor.setTelProp('nodeType', getNodeType(resource));
            return (await this.cache.getChildren(resource)).map(toKey);
        }
    }

    /**
     * Group all resources under a subscription according to
     * {@linkcode groupingStrategy}.
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
            const group: VirtualGroup = {
                subscription,
                groupingStrategy: this.groupingStrategy satisfies VirtualGroup['groupingStrategy'],
                groupingValue: this.groupingValue(resource),
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

    /** @inheritdoc */
    public dispose(): void {
        this.disposables.forEach(d => void d.dispose());
    }

    private get groupingStrategy(): GroupingStrategy {
        return this.code.workspace.getConfiguration(ConfigurationSection).get<GroupingStrategy>('groupBy', 'resourceGroup');
    }

    private get groupByTag(): string {
        return this.code.workspace.getConfiguration(ConfigurationSection).get<string>('groupByTag', '');
    }

    /**
     * Derive the grouping value for a resource given the current strategy.
     */
    private groupingValue(resource: GenericResource): string {
        switch (this.groupingStrategy) {
            case 'resourceType':
                return resource.logicalType;
            case 'location':
                return resource.location;
            case 'armTag':
                return resource.tags?.[this.groupByTag] || untaggedSentinel;
            default:
                return resource.logicalType;
        }
    }
}

// TODO: can we eliminate this? Make the providers all return `AzureNodeId`?
function toKey(node: AzureNode): string {
    return AzureNodeId.from(node).toString();
}

const virtualGroupNodeType = 'virtualGroup';
const untaggedSentinel = '__untagged__';
