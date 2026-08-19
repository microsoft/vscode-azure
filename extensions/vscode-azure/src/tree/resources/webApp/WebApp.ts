/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AppServiceLogicalType, FunctionAppLogicalType, isGenericResource, LogicAppLogicalType,
    type GenericResource,
} from '@microsoft/vscode-azure-azutils';
import { CaselessSet } from '@microsoft/vscode-azure-utils';

const WebAppLogicalTypes = new CaselessSet([
    FunctionAppLogicalType,
    AppServiceLogicalType,
    LogicAppLogicalType,
]);

/** Identifies Function App, App Service, and Logic App resources sharing the Web Apps ARM surface. */
export function isWebApp(resource: unknown): resource is GenericResource {
    return isGenericResource(resource) && WebAppLogicalTypes.has(resource.logicalType);
}
