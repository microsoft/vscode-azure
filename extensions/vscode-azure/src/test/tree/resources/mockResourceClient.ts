/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IResourceClient } from '@microsoft/vscode-azure-azutils';

/**
 * Creates an {@linkcode IResourceClient} that returns fixed resource groups and
 * resources.
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
        resourceGroups: { list: () => resourceGroups },
        resources: {
            listByResourceGroup: Array.isArray(resourcesByRg)
                ? () => resourcesByRg
                : (rgName: string) => resourcesByRg[rgName] ?? [],
        },
    } as unknown as IResourceClient;
}
