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
function singlePage<T>(items: T[]): AsyncIterable<Page<T>> {
    return {
        // eslint-disable-next-line @typescript-eslint/require-await -- minimal one-page async iterable for tests
        [Symbol.asyncIterator]: async function* () {
            yield { items, hasMore: false };
        },
    };
}

/**
 * Creates an {@linkcode IResourceClient} that returns fixed resource groups and
 * resources. Results are emitted as a single page so the mock conforms to the
 * `AsyncIterable<Page<T>>` shape returned by the real client.
 *
 * @param resourceGroups - The resource groups returned by `resourceGroups.list()`.
 * @param resourcesByRg - Either a flat list of resources returned for every
 *   resource group, or a map keyed by resource group name.
 */
export function createMockResourceClient(
    resourceGroups: unknown[],
    resourcesByRg: Record<string, unknown[]> | unknown[],
): IResourceClient {
    return {
        resourceGroups: { list: () => singlePage(resourceGroups) },
        resources: {
            listByResourceGroup: Array.isArray(resourcesByRg)
                ? () => singlePage(resourcesByRg)
                : (rgName: string) => singlePage(resourcesByRg[rgName] ?? []),
        },
    } as unknown as IResourceClient;
}
