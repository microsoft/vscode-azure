/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CacheKey, type IVsCode } from '@microsoft/vscode-azure-utils';
import type { GenericResource } from '../models/GenericResource';
import { isUnexpected } from '../rest/resources';
import { CachedResourceClient } from './CachedResourceClient';
import type { ResourceClientResolver } from './ResourceClientResolver';

// ── Scope Key ───────────────────────────────────────────────────────────────────

/** Cache key for listing resource groups in a subscription. */
export class ResourceGroupListScope implements CacheKey {
    public constructor(
        public readonly accountId: string,
        public readonly tenantId: string,
        public readonly subscriptionId: string,
    ) { }

    public toString(): string {
        return `rg:${this.accountId}/${this.tenantId}/${this.subscriptionId}`.toLowerCase();
    }
}

// ── Client ──────────────────────────────────────────────────────────────────────

/**
 * High-level client for Azure resource groups. Wraps the low-level REST client
 * and adds list-caching with TTL + inflight deduplication plus change notification.
 */
export class ResourceGroupsClient extends CachedResourceClient<ResourceGroupListScope> {
    public constructor(vscode: IVsCode, resolveClient: ResourceClientResolver, ttl: number) {
        super(vscode, resolveClient, ttl);
    }

    /**
     * Get a single resource group. Always fetches fresh (uncached).
     */
    public async get(
        accountId: string,
        tenantId: string,
        subscriptionId: string,
        resourceGroupName: string,
    ): Promise<GenericResource> {
        const client = this.resolveClient(accountId, tenantId);
        const response = await client
            .path(
                '/subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}',
                subscriptionId,
                resourceGroupName,
            )
            .get();

        if (isUnexpected(response)) {
            throw new Error(
                `Failed to get resource group '${resourceGroupName}': ${response.body.error?.code ?? response.status} — ${response.body.error?.message ?? 'Unknown error'}`,
            );
        }

        return toGenericResource(response.body);
    }

    protected async fetchList(scope: ResourceGroupListScope): Promise<GenericResource[]> {
        const client = this.resolveClient(scope.accountId, scope.tenantId);
        const response = await client
            .path('/subscriptions/{subscriptionId}/resourcegroups', scope.subscriptionId)
            .get();

        if (isUnexpected(response)) {
            throw new Error(
                `Failed to list resource groups: ${response.body.error?.code ?? response.status} — ${response.body.error?.message ?? 'Unknown error'}`,
            );
        }

        return (response.body.value ?? []).map(toGenericResource);
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function toGenericResource(output: { id?: string; name?: string; type?: string; location: string; tags?: Record<string, string> }): GenericResource {
    if (!output.id || !output.name || !output.type) {
        throw new Error(`Resource group response missing required fields: ${JSON.stringify(output)}`);
    }

    return {
        id: output.id,
        name: output.name,
        type: output.type,
        location: output.location,
        tags: output.tags,
    };
}
