/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CacheKey } from '@microsoft/vscode-azure-utils';
import type { GenericResource } from '../models/GenericResource';
import type { GenericResourceExpandedOutput } from '../rest/resources';
import { isUnexpected } from '../rest/resources';
import type { ResourceClientResolver } from './ResourceClientResolver';
import type { ResourceFetcher } from './ResourceFetcher';

// ── Keys ────────────────────────────────────────────────────────────────────────

/** Scope key for listing all resources in a subscription. */
export class SubscriptionResourceScopeKey implements CacheKey {
    public constructor(
        public readonly accountId: string,
        public readonly tenantId: string,
        public readonly subscriptionId: string,
    ) { }

    public toString(): string {
        return `res:${this.accountId}/${this.tenantId}/${this.subscriptionId}`.toLowerCase();
    }
}

/** Scope key for listing resources within a specific resource group. */
export class ResourceGroupResourceScopeKey implements CacheKey {
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

/** Union scope key — the fetcher handles both subscription-level and RG-level listing. */
export type GenericResourceScopeKey = SubscriptionResourceScopeKey | ResourceGroupResourceScopeKey;

/** Item key for a generic resource. */
export interface GenericResourceItemKey {
    /** The full ARM resource ID. */
    readonly resourceId: string;
}

// ── Fetcher ─────────────────────────────────────────────────────────────────────

function isResourceGroupScoped(key: GenericResourceScopeKey): key is ResourceGroupResourceScopeKey {
    return 'resourceGroupName' in key;
}

/**
 * Creates a {@link ResourceFetcher} for generic resources (subscription-level
 * and resource-group-level listing).
 *
 * **Note:** `fetchItem` is not supported — the Microsoft.Resources API does not
 * expose an individual GET for arbitrary resources. `get()` on the store will
 * throw. Use `getByList()` instead.
 */
export function createGenericResourceFetcher(resolveClient: ResourceClientResolver): ResourceFetcher<GenericResource, GenericResourceScopeKey, GenericResourceItemKey> {
    return {
        async fetchList(scope) {
            const client = resolveClient(scope.accountId, scope.tenantId);
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
        },

        fetchItem(_key) {
            throw new Error(
                'GenericResourceFetcher does not support fetchItem(). Use getByList() to find a resource within a cached list.',
            );
        },

        itemKeyEquals(resource, key) {
            return resource.id.toLowerCase() === key.resourceId.toLowerCase();
        },
    };
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
