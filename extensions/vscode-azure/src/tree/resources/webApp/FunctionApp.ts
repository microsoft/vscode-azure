/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    FunctionAppLogicalType,
    isGenericResource,
    type FunctionEnvelope,
    type GenericResource,
    type Site,
    type VirtualResource,
} from '@microsoft/vscode-azure-azutils';

/** Function App resource with the latest management-plane enrichment. */
export interface FunctionApp extends GenericResource {
    /** Populated in-place by the resource data provider. */
    site?: Site;
}

/** A remote function owned by a Function App, not a top-level ARM resource. */
export interface FunctionAppFunction extends VirtualResource {
    readonly virtualType: 'functionApp.function';
    readonly azureResource: FunctionApp;
    readonly data: FunctionEnvelope;
    /** Unqualified name used in the function management and host APIs. */
    readonly functionName: string;
    readonly triggerKind: string;
    readonly isDisabled: boolean;
    /** HTTP access level, absent for non-HTTP triggers. */
    readonly authLevel?: string;
}

/** Identifies Function Apps without treating other `Microsoft.Web/sites` kinds as functions. */
export function isFunctionApp(node: unknown): node is FunctionApp {
    return isGenericResource(node)
        && typeof node.logicalType === 'string'
        && node.logicalType.toLowerCase() === FunctionAppLogicalType.toLowerCase();
}

/** Identifies function leaves belonging to a Function App. */
export function isFunctionAppFunction(node: unknown): node is FunctionAppFunction {
    return !!node && typeof node === 'object'
        && 'virtualType' in node && node.virtualType === 'functionApp.function'
        && 'virtualPath' in node && typeof node.virtualPath === 'string'
        && 'azureResource' in node && isFunctionApp(node.azureResource)
        && 'functionName' in node && typeof node.functionName === 'string'
        && 'triggerKind' in node && typeof node.triggerKind === 'string'
        && 'isDisabled' in node && typeof node.isDisabled === 'boolean'
        && 'data' in node && !!node.data && typeof node.data === 'object';
}
