/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureNode, AzureSubscription, ConcreteAzureNode, GenericResource, GroupingStrategy, VirtualGroup } from '@microsoft/vscode-azure-azutils';
import { AIFoundryProjectLogicalType, AIServicesLogicalType, AppServiceLogicalType, AzureNodeId, CosmosDBLogicalType, CosmosDBMongoLogicalType, DurableTaskHubLogicalType, FunctionAppLogicalType, getNodeType, isAccount, isGenericResource, isResourceGroup, isSubscription, isTenant, LogicAppLogicalType, ResourceGroupArmType, SubscriptionArmType } from '@microsoft/vscode-azure-azutils';
import type { ITreeItem, ViewProvider } from '@microsoft/vscode-azure-utils';
import { Disposable, EventEmitter, Everything, IActionExecutor, ICodeContext, Limiter, type DataProviderChangeEvent } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { OpenInPortal } from '../../commands/tree/OpenInPortal';
import { AzdEnvNameTag, ConfigurationSection, SelectedSubscriptionsConfigurationKey } from '../../constants';
import { IAzureViewDataTree } from '../../services';
import { ISettingsDataProvider } from './settings/SettingsDataProvider';
import { parseSubscriptionFilterKey } from '../../utils/subscriptionFilter';
import { combineContextValues } from '../combineContextValues';
import { getResourceTypeIconUri } from '../iconPath';
import { AcrResourceType } from './acr/AcrRegistry';

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
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IAzureViewDataTree) private readonly cache: IAzureViewDataTree,
        @inject(ISettingsDataProvider) private readonly settings: ISettingsDataProvider,
    ) {
        this.disposables.push(ctx.code.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(`${ConfigurationSection}.alwaysShowAccountNodes`)
                || e.affectsConfiguration(`${ConfigurationSection}.groupBy`)
                || e.affectsConfiguration(`${ConfigurationSection}.groupByTag`)) {
                this.executor.output.debug('[view] resources grouping configuration changed');
                this.changeEmitter.fire({ target: Everything });
            } else if (e.affectsConfiguration(`${ConfigurationSection}.${SelectedSubscriptionsConfigurationKey}`)) {
                this.executor.output.debug('[view] subscription filter configuration changed');
                this.changeEmitter.fire({ target: Everything });
            }
        }));
    }

    // #region ViewProvider

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is string {
        if (typeof resource !== 'string' || !AzureNodeId.test(resource)) {
            return false;
        }

        // Exclude virtual resources (e.g. ACR repositories) -- those are
        // handled by service-specific view providers.
        const nodeId = AzureNodeId.parse(resource);
        return !nodeId.isVirtualResourceNodeId();
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
            const { label, resourceType } = this.getVirtualGroupPresentation(key);
            const item = new this.ctx.code.TreeItem(label, this.ctx.code.TreeItemCollapsibleState.Collapsed);
            item.id = key;
            if (resourceType) {
                item.iconPath = getResourceTypeIconUri(this.ctx, resourceType);
            } else {
                item.iconPath = new this.ctx.code.ThemeIcon('symbol-namespace');
            }
            return item;
        }

        const resource = this.cache.get(key);
        if (!resource) {
            throw new Error(`Resource with key ${key} not found in cache`);
        }

        this.executor.setTelProp('nodeType', getNodeType(resource));

        switch (true) {
            case isAccount(resource): {
                const item = new this.ctx.code.TreeItem(resource.label, this.ctx.code.TreeItemCollapsibleState.Collapsed);
                item.id = key;
                item.iconPath = new this.ctx.code.ThemeIcon('account');
                return item;
            }

            case isTenant(resource): {
                const label = resource.displayName;
                const item = new this.ctx.code.TreeItem(label, this.ctx.code.TreeItemCollapsibleState.Collapsed);
                item.id = key;
                item.iconPath = new this.ctx.code.ThemeIcon('organization');
                return item;
            }

            case isSubscription(resource): {
                const item = new this.ctx.code.TreeItem(resource.displayName, this.isOneRootSub ? this.ctx.code.TreeItemCollapsibleState.Expanded : this.ctx.code.TreeItemCollapsibleState.Collapsed);
                item.id = key;
                item.contextValue = combineContextValues(OpenInPortal.ContextValue);
                item.iconPath = getResourceTypeIconUri(this.ctx, SubscriptionArmType);
                return item;
            }

            case isResourceGroup(resource): {
                const item = new this.ctx.code.TreeItem(resource.name, this.ctx.code.TreeItemCollapsibleState.Collapsed);
                item.id = key;
                item.contextValue = combineContextValues(OpenInPortal.ContextValue);
                const azdEnvName = resource.tags?.[AzdEnvNameTag];
                if (azdEnvName) {
                    item.iconPath = new this.ctx.code.ThemeIcon('rocket');
                    item.description = azdEnvName;
                } else {
                    item.iconPath = getResourceTypeIconUri(this.ctx, ResourceGroupArmType);
                }
                return item;
            }

            case isGenericResource(resource): {
                // Expandable only when the product exposes settings; everything else is a leaf, so
                // no chevron appears on a node that would open to nothing.
                const collapsibleState = this.settings.getAdapter(resource)
                    ? this.ctx.code.TreeItemCollapsibleState.Collapsed
                    : this.ctx.code.TreeItemCollapsibleState.None;

                const item = new this.ctx.code.TreeItem(resource.name, collapsibleState);
                item.id = key;
                item.description = resource.logicalType;
                item.contextValue = combineContextValues(OpenInPortal.ContextValue);
                item.iconPath = getResourceTypeIconUri(this.ctx, resource.logicalType);
                return item;
            }

            default: {
                return new this.ctx.code.TreeItem(key);
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
        let nodes = this.applyFilter(await this.cache.getChildren(undefined));
        this.rootKind = 'account';
        this.isOneRootSub = false;

        const skip = !this.ctx.code.workspace.getConfiguration(ConfigurationSection).get<boolean>('alwaysShowAccountNodes', false);

        if (skip && nodes.length === 1 && isAccount(nodes[0])) {
            this.executor.output.debug('[view] skipping account level');
            nodes = this.applyFilter(await this.cache.getChildren(nodes[0]));
            this.rootKind = 'tenant';
        }

        if (skip && nodes.length === 1 && isTenant(nodes[0])) {
            this.executor.output.debug('[view] skipping tenant level');
            nodes = this.applyFilter(await this.cache.getChildren(nodes[0]));
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
            this.executor.output.debug(`[view] grouped subscription=${subscription.subscriptionId} strategy=${this.groupingStrategy} groups=${groups.size}`);
            const groupKeys = [...groups.keys()];
            if (this.groupingStrategy === 'resourceType') {
                return groupKeys
                    .map(groupKey => ({ groupKey, label: this.getVirtualGroupPresentation(groupKey).label }))
                    .sort((a, b) => a.label.localeCompare(b.label))
                    .map(({ groupKey }) => groupKey);
            } else {
                return groupKeys.sort();
            }
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
            this.executor.output.debug(`[view] virtual group children subscription=${subscription.subscriptionId} group=${key} count=${groups.get(key)?.length ?? 0}`);
            return groups.get(key) ?? [];
        }

        // Everything else: straight cache passthrough
        const resource = this.cache.get(key);
        if (!resource) {
            return [];
        } else {
            this.executor.setTelProp('nodeType', getNodeType(resource));
            return this.applyFilter(await this.cache.getChildren(resource)).map(toKey);
        }
    }

    /**
     * Apply the tenant/subscription filter from
     * `vscode-azure.selectedSubscriptions`.
     *
     * Each configured entry is a `tenantId/subscriptionId` pair. When the
     * setting is empty, no filtering is applied. Tenant nodes are kept only when
     * their tenant id appears in the filter; subscription nodes only when their
     * subscription id appears. Other node types pass through unchanged.
     *
     * Because the tree loads lazily, filtered-out tenants are never expanded, so
     * their subscriptions are never requested from Azure.
     */
    private applyFilter(nodes: ConcreteAzureNode[]): ConcreteAzureNode[] {
        const selected = this.ctx.code.workspace
            .getConfiguration(ConfigurationSection)
            .get<string[]>(SelectedSubscriptionsConfigurationKey, []);

        if (selected.length === 0) {
            return nodes;
        }

        const parsed = selected.map(parseSubscriptionFilterKey);
        const tenantFilter = new Set(parsed.map(entry => entry.tenantId).filter(Boolean));
        const subscriptionFilter = new Set(parsed.map(entry => entry.subscriptionId).filter(Boolean));

        return nodes.filter(node => {
            if (isTenant(node)) {
                return tenantFilter.has(node.tenantId.toLowerCase());
            } else if (isSubscription(node)) {
                return subscriptionFilter.has(node.subscriptionId.toLowerCase());
            } else {
                return true;
            }
        });
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
            this.executor.output.debug(`[view] resource-group discovery subscription=${subscription.subscriptionId} count=${resourceGroups.length}`);
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
        this.executor.output.debug(`[view] flattened resource groups subscription=${subscription.subscriptionId} count=${resourceGroups.length}`);

        const limiter = new Limiter<void>(5);
        await Promise.all(resourceGroups.map(rg => limiter.queue(() => this.cache.loadAll(rg))));

        const allResources = (
            await Promise.all(resourceGroups.map(rg => this.cache.getChildren(rg)))
        ).flat().filter((r): r is GenericResource => isGenericResource(r) && !isResourceGroup(r));
        this.executor.output.debug(`[view] flattened resources subscription=${subscription.subscriptionId} count=${allResources.length} strategy=${this.groupingStrategy}`);

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
        Disposable.disposeAll(this.disposables);
    }

    private get groupingStrategy(): GroupingStrategy {
        return this.ctx.code.workspace.getConfiguration(ConfigurationSection).get<GroupingStrategy>('groupBy', 'resourceGroup');
    }

    private get groupByTag(): string {
        return this.ctx.code.workspace.getConfiguration(ConfigurationSection).get<string>('groupByTag', '');
    }

    private getVirtualGroupPresentation(key: string): { readonly label: string; readonly resourceType?: string } {
        const grouping = AzureNodeId.parse(key).getGrouping();
        if (!grouping) {
            return { label: key };
        } else if (grouping.groupingValue === untaggedSentinel) {
            return { label: this.ctx.code.l10n.t('(No Tag)') };
        } else if (grouping.groupingStrategy === 'resourceType') {
            const label = this.getResourceTypeGroupLabel(grouping.groupingValue);
            return {
                label: label ?? grouping.groupingValue,
                resourceType: label ? grouping.groupingValue : undefined,
            };
        } else {
            return { label: grouping.groupingValue };
        }
    }

    private getResourceTypeGroupLabel(logicalType: string): string | undefined {
        switch (logicalType.toLowerCase()) {
            case AcrResourceType.toLowerCase():
                return this.ctx.code.l10n.t('Container Registries');
            case AIFoundryProjectLogicalType.toLowerCase():
                return this.ctx.code.l10n.t('AI Foundry Projects');
            case AIServicesLogicalType.toLowerCase():
                return this.ctx.code.l10n.t('AI Services');
            case AppServiceLogicalType.toLowerCase():
                return this.ctx.code.l10n.t('App Services');
            case CosmosDBLogicalType.toLowerCase():
                return this.ctx.code.l10n.t('Azure Cosmos DB');
            case CosmosDBMongoLogicalType.toLowerCase():
                return this.ctx.code.l10n.t('Azure Cosmos DB for MongoDB');
            case DurableTaskHubLogicalType.toLowerCase():
                return this.ctx.code.l10n.t('Durable Task Hubs');
            case FunctionAppLogicalType.toLowerCase():
                return this.ctx.code.l10n.t('Function Apps');
            case LogicAppLogicalType.toLowerCase():
                return this.ctx.code.l10n.t('Logic Apps');
            default:
                return undefined;
        }
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

function toKey(node: AzureNode): string {
    return AzureNodeId.from(node).toString();
}

const virtualGroupNodeType = 'virtualGroup';
const untaggedSentinel = '__untagged__';
