/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Page } from '@microsoft/vscode-azure-utils';
import type { ResourceClient } from './clientDefinitions';
import { isUnexpected } from './isUnexpected';
import type { GenericResourceExpandedOutput, ResourceGroupOutput } from './outputModels';

/**
 * Iterate pages of resource groups for a subscription.
 *
 * Handles `nextLink` chasing automatically. Each yielded {@link Page}
 * carries a `hasMore` flag so consumers know whether more pages remain
 * without an extra fetch.
 */
export async function* listResourceGroups(
    client: ResourceClient,
    subscriptionId: string,
    options?: { top?: number },
): AsyncIterable<Page<ResourceGroupOutput>> {
    const response = await client
        .path('/subscriptions/{subscriptionId}/resourcegroups', subscriptionId)
        .get({ queryParameters: { $top: options?.top } });

    if (isUnexpected(response)) {
        throw new Error(`Failed to list resource groups: ${response.body.error?.message ?? response.status}`);
    }

    const nextLink = response.body.nextLink;
    yield { items: response.body.value ?? [], hasMore: !!nextLink };

    yield* followNextLink<ResourceGroupOutput>(client, nextLink);
}

/**
 * Iterate pages of resources within a resource group.
 *
 * Handles `nextLink` chasing automatically. Each yielded {@link Page}
 * carries a `hasMore` flag so consumers know whether more pages remain
 * without an extra fetch.
 */
export async function* listResourcesByGroup(
    client: ResourceClient,
    subscriptionId: string,
    resourceGroupName: string,
    options?: { top?: number },
): AsyncIterable<Page<GenericResourceExpandedOutput>> {
    const response = await client
        .path(
            '/subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}/resources',
            subscriptionId,
            resourceGroupName,
        )
        .get({ queryParameters: { $top: options?.top } });

    if (isUnexpected(response)) {
        throw new Error(`Failed to list resources: ${response.body.error?.message ?? response.status}`);
    }

    const nextLink = response.body.nextLink;
    yield { items: response.body.value ?? [], hasMore: !!nextLink };

    yield* followNextLink<GenericResourceExpandedOutput>(client, nextLink);
}

/**
 * Chase `nextLink` URLs to yield subsequent pages of resources.
 * Azure REST APIs return absolute `nextLink` URLs that include all
 * query parameters needed for the next page.
 */
async function* followNextLink<T>(
    client: ResourceClient,
    nextLink: string | undefined,
): AsyncGenerator<Page<T>> {
    while (nextLink) {
        // pathUnchecked accepts absolute URLs and routes them through
        // the existing pipeline (credentials, dedup policy, etc.)
        const response = await client.pathUnchecked(nextLink).get();

        if (isUnexpected(response)) {
            throw new Error(`Failed to fetch next page: ${response.body.error?.message ?? response.status}`);
        }

        const body = response.body as { value?: T[]; nextLink?: string };
        nextLink = body.nextLink;
        yield { items: body.value ?? [], hasMore: !!nextLink };
    }
}
