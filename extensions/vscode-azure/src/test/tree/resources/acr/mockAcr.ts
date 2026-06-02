/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IAcrClient } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import type { AcrRegistry } from '../../../../tree/resources/acr/AcrRegistry';
import { AcrResourceType } from '../../../../tree/resources/acr/AcrRegistry';

export function makeAcrRegistry(overrides?: Partial<AcrRegistry>): AcrRegistry {
    return makeGenericResource({
        id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.ContainerRegistry/registries/myReg',
        name: 'myReg',
        type: AcrResourceType,
        logicalType: AcrResourceType,
        loginServer: 'myreg.azurecr.io',
        sku: { name: 'Basic', tier: 'Basic' },
        adminUserEnabled: false,
        ...overrides,
    }) as AcrRegistry;
}

/**
 * Creates an {@linkcode IAcrClient} whose `registries.get()` returns canned
 * details from {@linkcode registryDetailsByName}, keyed by registry name.
 * Names not present in the map fall back to minimal default details.
 *
 * @param registryDetailsByName - Map from registry name to the details
 *   returned by `registries.get()`.
 */
export function createMockAcrClient(
    registryDetailsByName: Record<string, unknown>,
): IAcrClient {
    return {
        registries: {
            get: (_rg: string, name: string) => Promise.resolve(
                registryDetailsByName[name] ?? { loginServer: '', sku: { name: 'Basic' }, adminUserEnabled: false },
            ),
        },
    } as unknown as IAcrClient;
}
