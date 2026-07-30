/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IResourceClient } from '@microsoft/vscode-azure-azutils';
import type { Page } from '@microsoft/vscode-azure-utils';

/**
 * Wraps a single array of items in a one-page {@linkcode AsyncIterable} of
 * {@linkcode Page Pages}, matching the paged-iteration contract that
 * `IResourceClient` exposes.
 */
export function singlePage<T>(items: T[]): AsyncIterable<Page<T>> {
    return {
        // eslint-disable-next-line @typescript-eslint/require-await -- minimal one-page async iterable for tests
        [Symbol.asyncIterator]: async function* () {
            yield { items, hasMore: false };
        },
    };
}

/**
 * Wraps several arrays of items in a multi-page {@linkcode AsyncIterable} of
 * {@linkcode Page Pages}, so tests can exercise continuation-token paging.
 *
 * Every page except the last reports `hasMore: true`, matching how the real
 * client surfaces an ARM `nextLink`.
 */
export function multiPage<T>(pages: T[][]): AsyncIterable<Page<T>> {
    return {
        // eslint-disable-next-line @typescript-eslint/require-await -- minimal multi-page async iterable for tests
        [Symbol.asyncIterator]: async function* () {
            for (let i = 0; i < pages.length; i++) {
                yield { items: pages[i], hasMore: i < pages.length - 1 };
            }
        },
    };
}

/**
 * Creates an {@linkcode IResourceClient} that returns fixed resource groups and
 * resources. Results are emitted as a single page so the mock conforms to the
 * `AsyncIterable<Page<T>>` shape returned by the real client.
 *
 * `resources.list()` (the subscription-wide listing) returns the union of every
 * resource group's resources, mirroring how the real ARM API relates the two
 * operations. Resources therefore need well-formed ARM `id`s, since the
 * subscription-wide path buckets them back into resource groups by parsing the ID.
 *
 * @param resourceGroups - The resource groups returned by `resourceGroups.list()`.
 * @param resourcesByRg - Either a flat list of resources returned for every
 *   resource group, or a map keyed by resource group name.
 */
export function createMockResourceClient(
    resourceGroups: unknown[],
    resourcesByRg: Record<string, unknown[]> | unknown[],
): IResourceClient {
    const allResources = Array.isArray(resourcesByRg)
        ? resourcesByRg
        : Object.values(resourcesByRg).flat();

    return {
        resourceGroups: { list: () => singlePage(resourceGroups) },
        resources: {
            list: () => singlePage(allResources),
            listByResourceGroup: Array.isArray(resourcesByRg)
                ? () => singlePage(resourcesByRg)
                : (rgName: string) => singlePage(resourcesByRg[rgName] ?? []),
        },
    } as unknown as IResourceClient;
}
