/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription, GenericResource, GroupingStrategy } from '@microsoft/vscode-azure-azutils';
import {
    getNodeType, IResourceClientProvider, isResourceGroup, isSubscription, parseAzureResourceId,
    type ConcreteAzureNode, type IResourceClient
} from '@microsoft/vscode-azure-azutils';
import {
    EventEmitter, Everything, IActionExecutor, IVsCode,
    type ChildResult, type DataProvider, type DataProviderChangeEvent, type Disposable, type Page, type ProviderResult
} from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { ConfigurationSection } from '../../constants';

/**
 * Default page size used when fetching paginated Azure resource lists.
 */
const DEFAULT_PAGE_SIZE = 50;

/**
 * How long a coalesced subscription-wide resource load may be reused, in
 * milliseconds.
 *
 * The load only has to outlive the burst of resource-group requests that one
 * tree render produces, which is bounded by in-memory work rather than I/O. The
 * generous window here is a safety margin, not a cache lifetime: it is
 * deliberately far shorter than the tree's own TTL so that a coalesced result
 * can never outlive the tree data it feeds.
 */
const BULK_LOAD_TTL = 30 * 1000;

/**
 * A coalesced subscription-wide resource load, bucketed by lower-cased
 * resource group name.
 */
interface BulkResourceLoad {
    readonly resources: Promise<Map<string, GenericResource[]>>;
    /** Wall-clock time after which this load must not be served. */
    readonly expiresAt: number;
    /** Evicts the entry so a load is never retained past its usefulness. */
    readonly evictionTimer: ReturnType<typeof setTimeout>;
}

/**
 * Data-layer provider for the resource-group and resource levels of the Azure
 * resources tree.
 *
 * Handles subscriptions (listing their resource groups) and resource groups
 * (listing their resources) via the ARM {@linkcode IResourceClient}. The
 * account / tenant / subscription levels above it are produced by
 * {@linkcode AzureAccountDataProvider}; service-specific providers (e.g.
 * {@linkcode AcrDataProvider}) handle children below the resource group level.
 *
 * When the view groups by anything other than resource group, the caller is
 * guaranteed to walk every resource group, so this provider switches to a
 * single subscription-wide resource listing and serves each resource group's
 * children out of it -- see {@linkcode loadAllResources}. The load is triggered
 * by the first resource group to ask, not by the subscription listing, so
 * callers that only want resource groups never pay for it. Under resource-group
 * grouping the per-group listing is kept, so expanding one group stays cheap.
 *
 * Fires {@linkcode onDidChange} when configuration affecting pagination changes.
 */
@injectable()
export class AzureResourceDataProvider implements DataProvider<ConcreteAzureNode>, Disposable {
    /**
     * Cached REST clients per subscription ID, so all calls for the same
     * subscription share one client instance.
     */
    private readonly clientCache = new Map<string, IResourceClient>();

    /**
     * Coalesced subscription-wide resource loads, keyed by subscription ID.
     * The resolved value buckets every resource in the subscription by
     * lower-cased resource group name.
     *
     * This is a request coalescer, not a cache: {@linkcode DataItemTree} already
     * owns cached children and their TTL. An entry only has to outlive the burst
     * of resource-group requests that a single tree render produces, so it is
     * discarded as soon as any of the following happens, whichever comes first:
     * the subscription's resource groups are listed again (which any refresh or
     * invalidation of the subscription must do first), {@linkcode BULK_LOAD_TTL}
     * elapses, or a settings change invalidates the whole tree.
     *
     * The TTL matters even though the resource-group listing normally resets the
     * entry: it bounds how stale a served result can be even if some future
     * caller invalidates a resource group without re-listing its subscription,
     * and it stops a subscription snapshot being retained after the user stops
     * looking at the tree.
     */
    private readonly bulkLoads = new Map<string, BulkResourceLoad>();

    private readonly changeEmitter = new EventEmitter<DataProviderChangeEvent<ConcreteAzureNode>>();
    private readonly disposables: Disposable[] = [this.changeEmitter];

    public readonly onDidChange = this.changeEmitter.event;

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IResourceClientProvider) private readonly createClient: IResourceClientProvider,
    ) {
        this.disposables.push(code.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(`${ConfigurationSection}.pageSize`)) {
                this.executor.output.debug('[data] resources config changed: pageSize');
                this.clearBulkLoads();
                this.changeEmitter.fire({ target: Everything });
            }
        }));
    }

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is ConcreteAzureNode {
        if (!resource || typeof resource !== 'object') {
            return false;
        }

        const node = resource as ConcreteAzureNode;
        return isSubscription(node) || isResourceGroup(node);
    }

    /**
     * @inheritdoc
     * @throws if `resource` is not a subscription or resource group.
     */
    public getChildren(resource?: ConcreteAzureNode): ProviderResult<ChildResult<ConcreteAzureNode>> {
        if (!resource) {
            throw new Error('AzureResourceDataProvider is not a root provider');
        }

        this.executor.setTelProp('nodeType', getNodeType(resource));

        switch (true) {
            case isSubscription(resource): {
                const client = this.getOrCreateClient(resource);

                // Listing the resource groups again starts a new generation, so
                // drop any previous bulk load: a refresh must never be served
                // from resources gathered before it.
                //
                // Deliberately no prefetch here. Not every caller that lists a
                // subscription's resource groups goes on to expand them --
                // `ChooseResourceGroupStep` treats resource groups as terminal
                // picks -- and eagerly pulling every resource in the
                // subscription for those callers would be pure waste.
                this.clearBulkLoad(resource.subscriptionId);

                this.executor.output.debug(`[data] discover resource groups subscription=${resource.subscriptionId} pageSize=${this.pageSize}`);
                return client.resourceGroups.list({ top: this.pageSize });
            }

            case isResourceGroup(resource): {
                if (this.shouldBulkLoad) {
                    this.executor.output.debug(`[data] discover resources resourceGroup=${resource.subscription.subscriptionId}/${resource.name} source=bulk`);
                    return this.resourcesFromBulkLoad(resource.subscription, resource.name);
                }

                const client = this.getOrCreateClient(resource.subscription);
                this.executor.output.debug(`[data] discover resources resourceGroup=${resource.subscription.subscriptionId}/${resource.name} pageSize=${this.pageSize}`);
                return client.resources.listByResourceGroup(resource.name, { top: this.pageSize });
            }

            default:
                throw new Error(`Unsupported resource type: ${JSON.stringify(resource)}`);
        }
    }

    /**
     * A one-page {@linkcode AsyncIterable} that resolves a single resource
     * group's children out of the shared subscription-wide load.
     *
     * The bulk load exhausts every ARM page before bucketing, so the result is
     * always complete and `hasMore` is always `false`.
     */
    private resourcesFromBulkLoad(subscription: AzureSubscription, resourceGroupName: string): AsyncIterable<Page<GenericResource>> {
        const load = () => this.loadAllResources(subscription);
        return {
            [Symbol.asyncIterator]: async function* () {
                const byResourceGroup = await load();
                yield { items: byResourceGroup.get(resourceGroupName.toLowerCase()) ?? [], hasMore: false };
            },
        };
    }

    /**
     * Get the shared subscription-wide resource load, starting one if none is
     * available for the current generation.
     *
     * The first resource group to ask triggers the load; every other resource
     * group in the same render joins it. An expired or rejected load is evicted
     * so the next caller starts a fresh one rather than being served a stale
     * snapshot or replaying the same error.
     */
    private loadAllResources(subscription: AzureSubscription): Promise<Map<string, GenericResource[]>> {
        const key = subscription.subscriptionId;
        const existing = this.bulkLoads.get(key);
        if (existing) {
            if (Date.now() < existing.expiresAt) {
                return existing.resources;
            }
            this.clearBulkLoad(key);
        }

        const entry: BulkResourceLoad = {
            resources: this.fetchAllResources(subscription),
            expiresAt: Date.now() + BULK_LOAD_TTL,
            evictionTimer: setTimeout(() => { this.clearBulkLoad(key); }, BULK_LOAD_TTL),
        };
        this.bulkLoads.set(key, entry);

        entry.resources.catch(() => {
            if (this.bulkLoads.get(key) === entry) {
                this.clearBulkLoad(key);
            }
        });

        return entry.resources;
    }

    /** Evict a subscription's coalesced load, if any, cancelling its eviction timer. */
    private clearBulkLoad(subscriptionId: string): void {
        const entry = this.bulkLoads.get(subscriptionId);
        if (entry) {
            clearTimeout(entry.evictionTimer);
            this.bulkLoads.delete(subscriptionId);
        }
    }

    /** Evict every coalesced load. */
    private clearBulkLoads(): void {
        for (const key of [...this.bulkLoads.keys()]) {
            this.clearBulkLoad(key);
        }
    }

    /**
     * Fetch every resource in the subscription in one ARM operation and bucket
     * the results by lower-cased resource group name.
     *
     * Resource group names are compared case-insensitively because the casing
     * embedded in a resource's ARM ID is whatever the caller used at creation
     * time, which need not match the canonical name returned by the resource
     * group list.
     *
     * Subscription-scoped resources (no resource group in their ID) are dropped:
     * they have no resource group to hang from in the tree, matching what the
     * per-resource-group listing returns.
     */
    private async fetchAllResources(subscription: AzureSubscription): Promise<Map<string, GenericResource[]>> {
        const client = this.getOrCreateClient(subscription);
        this.executor.output.debug(`[data] bulk discover resources subscription=${subscription.subscriptionId}`);

        const byResourceGroup = new Map<string, GenericResource[]>();
        let count = 0;

        // Deliberately no `top`: the page size setting controls incremental
        // expansion of a single resource group, whereas this path always
        // exhausts every page, so ARM's (much larger) default is what we want.
        for await (const page of client.resources.list()) {
            for (const item of page.items) {
                const resourceGroup = this.resourceGroupOf(item);
                if (!resourceGroup) {
                    continue;
                }

                const bucket = byResourceGroup.get(resourceGroup);
                if (bucket) {
                    bucket.push(item);
                } else {
                    byResourceGroup.set(resourceGroup, [item]);
                }
                count++;
            }
        }

        this.executor.output.debug(`[data] bulk discover done subscription=${subscription.subscriptionId} resources=${count} groups=${byResourceGroup.size}`);
        return byResourceGroup;
    }

    /**
     * Extract the lower-cased resource group name from a resource's ARM ID,
     * or `undefined` when the resource is not scoped to a resource group.
     */
    private resourceGroupOf(resource: GenericResource): string | undefined {
        try {
            return parseAzureResourceId(resource.id).resourceGroup?.toLowerCase();
        } catch {
            this.executor.output.debug(`[data] bulk discover skipped resource with unparsable id type=${resource.type}`);
            return undefined;
        }
    }

    /**
     * Get or create a cached REST client for the given subscription.
     * All callers for the same subscription share the same client instance.
     */
    private getOrCreateClient(subscription: AzureSubscription): IResourceClient {
        let client = this.clientCache.get(subscription.subscriptionId);
        if (!client) {
            client = this.createClient(subscription);
            this.clientCache.set(subscription.subscriptionId, client);
        }

        return client;
    }

    private get pageSize(): number {
        return this.code.workspace.getConfiguration(ConfigurationSection).get('pageSize', DEFAULT_PAGE_SIZE);
    }

    /**
     * Whether a resource group's children should be served from a single
     * subscription-wide listing rather than its own ARM call.
     *
     * True for every grouping strategy except `'resourceGroup'`, because those
     * strategies bucket resources across group boundaries and so force the view
     * to load every resource group before it can render anything. Under
     * `'resourceGroup'` grouping the tree expands one group at a time, and
     * scanning the whole subscription to satisfy that would be a regression.
     */
    private get shouldBulkLoad(): boolean {
        return this.code.workspace
            .getConfiguration(ConfigurationSection)
            .get<GroupingStrategy>('groupBy', 'resourceGroup') !== 'resourceGroup';
    }

    /** @inheritdoc */
    public dispose(): void {
        this.clearBulkLoads();
        this.disposables.forEach(d => void d.dispose());
    }
}
