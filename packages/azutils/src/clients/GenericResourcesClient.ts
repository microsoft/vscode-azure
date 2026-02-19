/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CacheKey, type IVsCode } from '@microsoft/vscode-azure-utils';
import type { GenericResource } from '../models/GenericResource';
import type { GenericResourceExpandedOutput } from '../rest/resources';
import { isUnexpected } from '../rest/resources';
import { CachedResourceClient } from './CachedResourceClient';
import type { ResourceClientResolver } from './ResourceClientResolver';

// ── Scope Keys ──────────────────────────────────────────────────────────────────

/** Cache key for listing all resources in a subscription. */
export class SubscriptionResourceListScope implements CacheKey {
    public constructor(
        public readonly accountId: string,
        public readonly tenantId: string,
        public readonly subscriptionId: string,
    ) { }

    public toString(): string {
        return `res:${this.accountId}/${this.tenantId}/${this.subscriptionId}`.toLowerCase();
    }
}

/** Cache key for listing resources within a specific resource group. */
export class ResourceGroupResourceListScope implements CacheKey {
    public constructor(
        public readonly accountId: string,
        public readonly tenantId: string,
        public readonly subscriptionId: string,
        public readonly resourceGroupName: string,
    ) { }

    public toString(): string {
        return `res:${this.accountId}/${this.tenantId}/${this.subscriptionId}/${this.resourceGroupName}`.toLowerCase();
    }
}

/** Union scope — the client handles both subscription-level and RG-level listing. */
export type GenericResourceListScope = SubscriptionResourceListScope | ResourceGroupResourceListScope;

// ── Client ──────────────────────────────────────────────────────────────────────

function isResourceGroupScoped(scope: GenericResourceListScope): scope is ResourceGroupResourceListScope {
    return 'resourceGroupName' in scope;
}

/**
 * High-level client for generic Azure resources (Microsoft.Resources). Wraps
 * the low-level REST client and adds list-caching with TTL + inflight
 * deduplication plus change notification.
 *
 * Supports listing at both subscription and resource-group scope.
 *
 * **Note:** There is no `get()` method — the Microsoft.Resources API does not
 * expose an individual GET for arbitrary resources. Use `getByList()` to find
 * a resource within a cached list, or use a service-specific client for
 * individual resource operations.
 */
export class GenericResourcesClient extends CachedResourceClient<GenericResourceListScope> {
    public constructor(vscode: IVsCode, resolveClient: ResourceClientResolver, ttl: number) {
        super(vscode, resolveClient, ttl);
    }

    /**
     * Find a single resource by ID within a cached list.
     *
     * @returns The matching resource, or `undefined` if not found.
     */
    public async getByList(scope: GenericResourceListScope, resourceId: string): Promise<GenericResource | undefined> {
        const resources = await this.list(scope);
        return resources.find((r) => r.id.toLowerCase() === resourceId.toLowerCase());
    }

    protected async fetchList(scope: GenericResourceListScope): Promise<GenericResource[]> {
        const client = this.resolveClient(scope.accountId, scope.tenantId);

        if (isResourceGroupScoped(scope)) {
            const response = await client
                .path(
                    '/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/resources',
                    scope.subscriptionId,
                    scope.resourceGroupName,
                )
                .get();

            if (isUnexpected(response)) {
                throw new Error(
                    `Failed to list resources in '${scope.resourceGroupName}': ${response.body.error?.code ?? response.status} — ${response.body.error?.message ?? 'Unknown error'}`,
                );
            }

            return (response.body.value ?? []).map(toGenericResource);
        }

        const response = await client
            .path('/subscriptions/{subscriptionId}/resources', scope.subscriptionId)
            .get();

        if (isUnexpected(response)) {
            throw new Error(
                `Failed to list resources: ${response.body.error?.code ?? response.status} — ${response.body.error?.message ?? 'Unknown error'}`,
            );
        }

        return (response.body.value ?? []).map(toGenericResource);
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function toGenericResource(output: GenericResourceExpandedOutput): GenericResource {
    if (!output.id || !output.name || !output.type || !output.location) {
        throw new Error(`Resource response missing required fields: ${JSON.stringify(output)}`);
    }

    return {
        id: output.id,
        name: output.name,
        type: output.type,
        location: output.location,
        tags: output.tags,
        kind: output.kind,
    };
}
