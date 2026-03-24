/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
