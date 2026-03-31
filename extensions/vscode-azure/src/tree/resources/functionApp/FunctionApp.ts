/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { GenericResource } from '@microsoft/vscode-azure-azutils';
import { FunctionAppLogicalType, isGenericResource } from '@microsoft/vscode-azure-azutils';

/**
 * Type guard that narrows an unknown value to a Function App {@link GenericResource}.
 *
 * Returns `true` for `GenericResource` nodes whose `logicalType` matches
 * `Microsoft.Web/sites~functionapp` (case-insensitive).
 */
export function isFunctionApp(node: unknown): node is GenericResource {
    return !!node && typeof node === 'object' && isGenericResource(node as GenericResource)
        && (node as GenericResource).logicalType.toLowerCase() === FunctionAppLogicalType.toLowerCase();
}
