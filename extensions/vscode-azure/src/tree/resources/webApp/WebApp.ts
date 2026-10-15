/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AppServiceLogicalType, FunctionAppLogicalType, isGenericResource, LogicAppLogicalType,
    type GenericResource, type Site,
} from '@microsoft/vscode-azure-azutils';
import { CaselessSet } from '@microsoft/vscode-azure-utils';

const WebAppLogicalTypes = new CaselessSet([
    FunctionAppLogicalType,
    AppServiceLogicalType,
    LogicAppLogicalType,
]);

/** An App Service-family resource with its latest management-plane site metadata. */
export interface WebApp extends GenericResource {
    /** Populated in-place by the resource data provider. */
    site?: Site;
}

/** Identifies Function App, App Service, and Logic App resources sharing the Web Apps ARM surface. */
export function isWebApp(resource: unknown): resource is WebApp {
    return isGenericResource(resource) && WebAppLogicalTypes.has(resource.logicalType);
}
