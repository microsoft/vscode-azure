/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FunctionAppLogicalType, type GenericResource } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';

export function makeFunctionApp(overrides?: Partial<GenericResource>): GenericResource {
    return makeGenericResource({
        id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Web/sites/myFunc',
        name: 'myFunc',
        type: 'Microsoft.Web/sites',
        logicalType: FunctionAppLogicalType,
        ...overrides,
    });
}
