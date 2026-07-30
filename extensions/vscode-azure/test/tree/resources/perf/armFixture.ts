/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PipelineRequest, PipelineResponse } from '@microsoft/vscode-azure-azutils/testing';
import { makeResponse } from '@microsoft/vscode-azure-azutils/testing';

/** ARM type used for the container registries that exercise enrichment. */
export const AcrType = 'Microsoft.ContainerRegistry/registries';

/**
 * ARM types the generated resources cycle through, so that grouping by
 * resource type produces more than one group. The first entry is deliberately
 * {@linkcode AcrType}-free: registries are placed explicitly by
 * {@linkcode ArmFixtureSpec.acrRegistries} so their count is exact.
 */
const ResourceTypes = [
    'Microsoft.Storage/storageAccounts',
    'Microsoft.Web/sites',
    'Microsoft.DocumentDB/databaseAccounts',
    'Microsoft.KeyVault/vaults',
    'Microsoft.Insights/components',
];

/** Locations the generated resources cycle through, for `groupBy: location`. */
const Locations = ['eastus', 'westus2', 'westeurope'];

/**
 * Shape of one synthetic subscription, from which
 * {@linkcode createArmFixture} derives every ARM response.
 *
 * Everything here is a count rather than a literal, so a scenario reads as the
 * *topology* being measured (how many groups, how many resources, how many ARM
 * pages) rather than as a wall of fixture data.
 */
export interface ArmFixtureSpec {
    /** Number of resource groups in the subscription. */
    readonly resourceGroups: number;
    /**
     * Total number of resources, dealt round-robin across the resource groups.
     * Resource groups past `totalResources` end up empty, which is a real ARM
     * shape: the subscription-wide listing omits them entirely.
     */
    readonly totalResources: number;
    /**
     * How many of the resources are container registries. These are the only
     * resources with an `enrich` implementation, so this count drives both the
     * enrichment ARM calls and the view's full-refresh escalation.
     */
    readonly acrRegistries?: number;
    /**
     * Page size ARM applies to the subscription-wide `/resources` listing --
     * i.e. how many resources come back per round trip. The real service uses
     * a large default; a small value here is how a scenario reproduces a
     * heavily-paginated subscription.
     */
    readonly resourcePageSize?: number;
    /** Subscription id embedded in every generated ARM id. */
    readonly subscriptionId?: string;
}

/** A generated resource group, in the shape ARM returns it. */
interface FixtureResourceGroup {
    readonly id: string;
    readonly name: string;
    readonly type: 'Microsoft.Resources/resourceGroups';
    readonly location: string;
}

/** A generated resource, in the shape ARM returns it. */
interface FixtureResource {
    readonly id: string;
    readonly name: string;
    readonly type: string;
    readonly location: string;
    readonly kind?: string;
    readonly tags?: Record<string, string>;
    /** Lower-cased owning resource group name; not part of the ARM payload. */
    readonly resourceGroupName: string;
}

/**
 * A synthetic ARM endpoint: canned resource groups and resources plus a
 * request handler that serves them with real pagination.
 */
export interface ArmFixture {
    readonly subscriptionId: string;
    readonly resourceGroups: readonly FixtureResourceGroup[];
    readonly resources: readonly FixtureResource[];
    /**
     * Handler for {@linkcode MockHttpClient}. Routes on the request URL the
     * same way ARM does, so the SDK's own paging (`nextLink`) drives the number
     * of round trips rather than the test asserting it directly.
     *
     * @throws if the URL does not match a route the fixture knows about --
     *   silently returning an empty body would turn a wiring mistake into a
     *   misleadingly good metric.
     */
    handle(request: PipelineRequest): PipelineResponse;
}

/**
 * Build a synthetic ARM endpoint from a topology description.
 *
 * Resources are dealt round-robin across the resource groups and cycle through
 * a fixed list of types and locations, so every grouping strategy has something
 * to group by and the result is identical on every run.
 */
export function createArmFixture(spec: ArmFixtureSpec): ArmFixture {
    const subscriptionId = spec.subscriptionId ?? 'test-sub';
    const acrCount = spec.acrRegistries ?? 0;
    const resourcePageSize = spec.resourcePageSize ?? 1000;

    const resourceGroups: FixtureResourceGroup[] = [];
    for (let i = 0; i < spec.resourceGroups; i++) {
        const name = `rg${i}`;
        resourceGroups.push({
            id: `/subscriptions/${subscriptionId}/resourceGroups/${name}`,
            name,
            type: 'Microsoft.Resources/resourceGroups',
            location: Locations[i % Locations.length],
        });
    }

    const resources: FixtureResource[] = [];
    for (let i = 0; resourceGroups.length > 0 && i < spec.totalResources; i++) {
        // Round-robin rather than blocked, so a scenario with fewer resources
        // than groups still spreads across groups instead of filling the first.
        const group = resourceGroups[i % resourceGroups.length];

        const type = i < acrCount ? AcrType : ResourceTypes[i % ResourceTypes.length];
        const name = `res${i}`;
        resources.push({
            id: `${group.id}/providers/${type}/${name}`,
            name,
            type,
            location: Locations[i % Locations.length],
            tags: { env: i % 2 === 0 ? 'prod' : 'dev' },
            resourceGroupName: group.name.toLowerCase(),
        });
    }

    /** Project to ARM's wire shape, dropping the fixture-only bookkeeping field. */
    const toArm = (resource: FixtureResource): Record<string, unknown> => ({
        id: resource.id,
        name: resource.name,
        type: resource.type,
        location: resource.location,
        kind: resource.kind,
        tags: resource.tags,
    });

    /**
     * Serialise one page and, when more items remain, a `nextLink` carrying the
     * offset. The SDK follows the link verbatim, so paging costs exactly one
     * extra round trip per page.
     */
    const page = (url: URL, items: readonly unknown[], skip: number, size: number): string => {
        const slice = items.slice(skip, skip + size);
        const next = skip + size < items.length
            ? (() => {
                const link = new URL(url.toString());
                link.searchParams.set('$skiptoken', String(skip + size));
                return link.toString();
            })()
            : undefined;
        return JSON.stringify({ value: slice, nextLink: next });
    };

    const handle = (request: PipelineRequest): PipelineResponse => {
        const url = new URL(request.url);
        const path = url.pathname.toLowerCase();
        const skip = Number(url.searchParams.get('$skiptoken') ?? '0');
        // `$top` is ARM's page size for the listings the tree passes it to.
        const top = Number(url.searchParams.get('$top') ?? '0') || undefined;

        const subscriptionPrefix = `/subscriptions/${subscriptionId.toLowerCase()}`;

        if (path === `${subscriptionPrefix}/resourcegroups`) {
            return makeResponse(request, 200, page(url, resourceGroups, skip, top ?? resourceGroups.length + 1));
        }

        if (path === `${subscriptionPrefix}/resources`) {
            return makeResponse(request, 200, page(url, resources.map(toArm), skip, resourcePageSize));
        }

        const byGroup = /^\/subscriptions\/[^/]+\/resourcegroups\/([^/]+)\/resources$/.exec(path);
        if (byGroup) {
            const owned = resources.filter(r => r.resourceGroupName === byGroup[1]).map(toArm);
            return makeResponse(request, 200, page(url, owned, skip, top ?? owned.length + 1));
        }

        const registry = /\/providers\/microsoft\.containerregistry\/registries\/([^/]+)$/.exec(path);
        if (registry) {
            const name = registry[1];
            return makeResponse(request, 200, JSON.stringify({
                id: `${subscriptionPrefix}/resourcegroups/rg0/providers/${AcrType}/${name}`,
                name,
                type: AcrType,
                location: 'eastus',
                properties: { loginServer: `${name}.azurecr.io`, adminUserEnabled: false },
                sku: { name: 'Basic', tier: 'Basic' },
            }));
        }

        throw new Error(`ArmFixture has no route for ${request.method} ${request.url}`);
    };

    return { subscriptionId, resourceGroups, resources, handle };
}

/**
 * Classify a request URL into a coarse ARM operation name, for the per-operation
 * breakdown in the diagnostics. Purely descriptive -- nothing is gated on it.
 */
export function classifyArmRequest(url: string): string {
    const path = new URL(url).pathname.toLowerCase();
    if (/\/resourcegroups\/[^/]+\/resources$/.test(path)) {
        return 'resources.listByResourceGroup';
    }
    if (path.endsWith('/resourcegroups')) {
        return 'resourceGroups.list';
    }
    if (path.endsWith('/resources')) {
        return 'resources.list';
    }
    if (/\/providers\/microsoft\.containerregistry\/registries\/[^/]+$/.test(path)) {
        return 'acr.registries.get';
    }
    return 'other';
}
