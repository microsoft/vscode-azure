/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription, GenericResource } from '@microsoft/vscode-azure-azutils';
import {
    getNodeType, IResourceClientProvider, isResourceGroup, isSubscription, parseAzureResourceId,
    type ConcreteAzureNode, type IResourceClient
} from '@microsoft/vscode-azure-azutils';
import {
    EventEmitter, Everything, IActionExecutor, IVsCode,
    type ChildResult, type DataProvider, type DataProviderChangeEvent, type Disposable, type Page, type ProviderResult
} from '@microsoft/vscode-azure-utils';
import { inject, injectable, type ServiceIdentifier } from 'inversify';
import { ConfigurationSection } from '../../constants';

/**
 * Default page size used when fetching paginated Azure resource lists.
 */
const DEFAULT_PAGE_SIZE = 50;

/**
 * Service identifier for {@linkcode AzureResourceDataProvider}, so the view
 * layer can open a bulk-load window via
 * {@linkcode AzureResourceDataProvider.beginBulkLoad}.
 */
export const IAzureResourceDataProvider: ServiceIdentifier<AzureResourceDataProvider> = Symbol.for('IAzureResourceDataProvider');

/**
 * An open bulk-load window for one subscription.
 *
 * The window exists only while a caller has declared that it is about to walk
 * every resource group in the subscription. `resources` is started lazily by
 * the first resource group that actually asks, so opening a window that turns
 * out to be unnecessary costs nothing.
 */
interface BulkLoadWindow {
    /**
     * Number of open {@linkcode AzureResourceDataProvider.beginBulkLoad}
     * handles. Overlapping renders share one window -- and therefore one ARM
     * listing -- and the window closes when the last handle is disposed.
     */
    refCount: number;
    /** The shared listing, started by the first resource group to ask. */
    resources?: Promise<Map<string, GenericResource[]>>;
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
 * By default each resource group lists its own resources, so expanding one
 * group stays cheap. A caller that knows it is about to walk *every* resource
 * group can say so with {@linkcode beginBulkLoad}; for the lifetime of that
 * window this provider serves every resource group out of a single
 * subscription-wide listing instead of one call per group.
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
     * Open bulk-load windows, keyed by subscription ID.
     *
     * This is a request coalescer, not a cache: {@linkcode DataItemTree} already
     * owns cached children and their TTL. An entry lives exactly as long as the
     * {@linkcode beginBulkLoad} handles that opened it, so a listing can never
     * outlive the walk that asked for it and there is no expiry to tune.
     */
    private readonly bulkLoads = new Map<string, BulkLoadWindow>();

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
                this.changeEmitter.fire({ target: Everything });
            }
        }));
    }

    /**
     * Declare that the caller is about to load every resource group in
     * `subscription`, and should be served from one subscription-wide listing
     * rather than one ARM call per resource group.
     *
     * Whether a full walk is happening is a *view*-layer decision (it depends on
     * the grouping strategy), so the view layer states it explicitly here rather
     * than this provider inferring it from presentation settings.
     *
     * The listing is started lazily by the first resource group that asks, so a
     * window that turns out not to need one is free. Overlapping windows for the
     * same subscription share a single listing; the window -- and the snapshot
     * it holds -- is discarded once every handle is disposed.
     *
     * @returns a handle that must be disposed once the walk is complete.
     *          Disposing more than once is a no-op.
     */
    public beginBulkLoad(subscription: AzureSubscription): Disposable {
        const key = subscription.subscriptionId;
        const window = this.bulkLoads.get(key) ?? { refCount: 0 };
        window.refCount++;
        this.bulkLoads.set(key, window);

        let disposed = false;
        return {
            dispose: () => {
                if (disposed) {
                    return;
                }

                disposed = true;
                if (--window.refCount <= 0 && this.bulkLoads.get(key) === window) {
                    this.bulkLoads.delete(key);
                }
            },
        };
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
                this.executor.output.debug(`[data] discover resource groups subscription=${resource.subscriptionId} pageSize=${this.pageSize}`);
                return client.resourceGroups.list({ top: this.pageSize });
            }

            case isResourceGroup(resource): {
                // An open window means the caller is walking every resource
                // group, so serve this one from the shared listing.
                const window = this.bulkLoads.get(resource.subscription.subscriptionId);
                if (window) {
                    this.executor.output.debug(`[data] discover resources resourceGroup=${resource.subscription.subscriptionId}/${resource.name} source=bulk`);
                    return this.resourcesFromBulkLoad(window, resource.subscription, resource.name);
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
     * group's children out of the shared subscription-wide listing.
     *
     * The listing exhausts every ARM page before bucketing, so the result is
     * always complete and `hasMore` is always `false`.
     *
     * The window is captured by reference rather than looked up again at
     * iteration time, so a listing already in flight is always awaited by the
     * groups that asked for it -- even if the window closes meanwhile.
     */
    private resourcesFromBulkLoad(window: BulkLoadWindow, subscription: AzureSubscription, resourceGroupName: string): AsyncIterable<Page<GenericResource>> {
        const load = () => this.loadAllResources(window, subscription);
        return {
            [Symbol.asyncIterator]: async function* () {
                const byResourceGroup = await load();

                // A resource group missing from the listing is empty, not
                // unknown: the subscription-wide listing omits empty groups,
                // which is why the resource group list is still fetched
                // separately.
                yield { items: byResourceGroup.get(resourceGroupName.toLowerCase()) ?? [], hasMore: false };
            },
        };
    }

    /**
     * Get the window's shared subscription-wide listing, starting it if the
     * window has not needed one yet.
     *
     * The first resource group to ask triggers the listing; every other
     * resource group in the same window joins it, whether it asks while the
     * listing is in flight or long after it settled.
     */
    private loadAllResources(window: BulkLoadWindow, subscription: AzureSubscription): Promise<Map<string, GenericResource[]>> {
        // Assigned before the first `await`, so concurrent callers cannot race
        // into starting a second listing.
        window.resources ??= this.fetchAllResources(subscription);
        return window.resources;
    }

    /** Discard every open window, abandoning any listing they hold. */
    private clearBulkLoads(): void {
        this.bulkLoads.clear();
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
            // Identify the resource by name and type rather than by its ARM ID:
            // the ID is what failed to parse, and it embeds the subscription ID.
            this.executor.output.debug(`[data] bulk discover skipped resource with unparsable id name=${resource.name} type=${resource.type}`);
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

    /** @inheritdoc */
    public dispose(): void {
        this.clearBulkLoads();
        this.disposables.forEach(d => void d.dispose());
    }
}
