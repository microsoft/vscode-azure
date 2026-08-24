/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IResourceClient } from '@microsoft/vscode-azure-azutils';
import { asPages } from '@microsoft/vscode-azure-utils/testing';

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
        resourceGroups: { list: () => asPages(resourceGroups) },
        resources: {
            listByResourceGroup: Array.isArray(resourcesByRg)
                ? () => asPages(resourcesByRg)
                : (rgName: string) => asPages(resourcesByRg[rgName] ?? []),
        },
    } as unknown as IResourceClient;
}
