/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CacheKey } from '@microsoft/vscode-azure-utils';
import type { GenericResource } from '../models/GenericResource';
import { isUnexpected } from '../rest/resources';
import type { ResourceClientResolver } from './ResourceClientResolver';
import type { ResourceFetcher } from './ResourceFetcher';

// ── Keys ────────────────────────────────────────────────────────────────────────

/** Scope key for listing resource groups in a subscription. */
export class ResourceGroupScopeKey implements CacheKey {
    public constructor(
        public readonly accountId: string,
        public readonly tenantId: string,
        public readonly subscriptionId: string,
    ) { }

    public toString(): string {
        return `rg:${this.accountId}/${this.tenantId}/${this.subscriptionId}`.toLowerCase();
    }
}

/** Item key for getting a single resource group. */
export interface ResourceGroupItemKey {
    readonly accountId: string;
    readonly tenantId: string;
    readonly subscriptionId: string;
    readonly resourceGroupName: string;
}

// ── Fetcher ─────────────────────────────────────────────────────────────────────

/**
 * Creates a {@link ResourceFetcher} for resource groups.
 *
 * @param resolveClient - Resolves the correct {@link ResourceClient} for a
 *   given account + tenant pair (each pair uses its own `TokenCredential`).
 */
export function createResourceGroupFetcher(resolveClient: ResourceClientResolver): ResourceFetcher<GenericResource, ResourceGroupScopeKey, ResourceGroupItemKey> {
    return {
        async fetchList(scope) {
            const client = resolveClient(scope.accountId, scope.tenantId);
            const response = await client
                .path('/subscriptions/{subscriptionId}/resourcegroups', scope.subscriptionId)
                .get();

            if (isUnexpected(response)) {
                throw new Error(
                    `Failed to list resource groups: ${response.body.error?.code ?? response.status} — ${response.body.error?.message ?? 'Unknown error'}`,
                );
            }

            return (response.body.value ?? []).map(toGenericResource);
        },

        async fetchItem(key) {
            const client = resolveClient(key.accountId, key.tenantId);
            const response = await client
                .path(
                    '/subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}',
                    key.subscriptionId,
                    key.resourceGroupName,
                )
                .get();

            if (isUnexpected(response)) {
                throw new Error(
                    `Failed to get resource group '${key.resourceGroupName}': ${response.body.error?.code ?? response.status} — ${response.body.error?.message ?? 'Unknown error'}`,
                );
            }

            return toGenericResource(response.body);
        },

        itemKeyEquals(resource, key) {
            return resource.id.toLowerCase() ===
                `/subscriptions/${key.subscriptionId}/resourcegroups/${key.resourceGroupName}`.toLowerCase();
        },
    };
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
