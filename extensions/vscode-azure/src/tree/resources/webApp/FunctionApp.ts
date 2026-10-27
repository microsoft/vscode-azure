/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    FunctionAppLogicalType,
    isGenericResource,
    type FunctionEnvelope,
    type Site,
    type VirtualResource,
} from '@microsoft/vscode-azure-azutils';
import type { ICaselessMapReader } from '@microsoft/vscode-azure-utils';
import type { WebApp } from './WebApp';

/** Function App resource with the latest management-plane enrichment. */
export interface FunctionApp extends WebApp {
    /** Failure from the latest site read, cleared after a successful retry. */
    siteError?: string;
    /** Whether function files are read-only; absent when deployment settings could not be read. */
    isReadOnly?: boolean;
}

/** Package-backed and Flex deployments do not support editing individual function files. */
export function isFunctionAppReadOnly(site: Site, values: ICaselessMapReader<string>): boolean {
    return !!site.functionAppConfig || ['WEBSITE_RUN_FROM_PACKAGE', 'WEBSITE_RUN_FROM_ZIP']
        .some(key => !/^(?:false|0)?$/i.test(values.get(key) ?? ''));
}

/** Stable discriminators for Function App virtual children. */
export const FunctionAppVirtualTypes = {
    Functions: 'functionApp.functions',
    Function: 'functionApp.function',
    Invalid: 'functionApp.invalid',
} as const;

/** Remote functions category beneath a Function App's application settings. */
export interface FunctionAppFunctions extends VirtualResource {
    readonly virtualType: typeof FunctionAppVirtualTypes.Functions;
    readonly azureResource: FunctionApp;
}

/** A remote function owned by a Function App, not a top-level ARM resource. */
export interface FunctionAppFunction extends VirtualResource {
    readonly virtualType: typeof FunctionAppVirtualTypes.Function;
    readonly azureResource: FunctionApp;
    readonly data: FunctionEnvelope;
    /** Unqualified name used in the function management and host APIs. */
    readonly functionName: string;
    readonly triggerKind: string;
    readonly isDisabled: boolean;
    /** HTTP access level, absent for non-HTTP triggers. */
    readonly authLevel?: string;
}

/** Visible failure for a site read, function listing, or malformed function metadata. */
export interface FunctionAppInvalidNode extends VirtualResource {
    readonly virtualType: typeof FunctionAppVirtualTypes.Invalid;
    readonly azureResource: FunctionApp;
    readonly kind: 'app' | 'functions' | 'function';
    readonly error: string;
    /** Name reported by Azure, when the failure concerns an individual function. */
    readonly sourceLabel?: string;
}

/** Virtual nodes owned by the remote Function App providers. */
export type FunctionAppVirtualNode = FunctionAppFunctions | FunctionAppFunction | FunctionAppInvalidNode;

/** Identifies Function Apps without treating other `Microsoft.Web/sites` kinds as functions. */
export function isFunctionApp(node: unknown): node is FunctionApp {
    return isGenericResource(node)
        && typeof node.logicalType === 'string'
        && node.logicalType.toLowerCase() === FunctionAppLogicalType.toLowerCase();
}

/** Identifies function leaves belonging to a Function App. */
export function isFunctionAppFunction(node: unknown): node is FunctionAppFunction {
    return isFunctionAppVirtualNode(node)
        && node.virtualType === FunctionAppVirtualTypes.Function
        && 'functionName' in node && typeof node.functionName === 'string'
        && 'triggerKind' in node && typeof node.triggerKind === 'string'
        && 'isDisabled' in node && typeof node.isDisabled === 'boolean'
        && 'data' in node && !!node.data && typeof node.data === 'object'; // eslint-disable-line @typescript-eslint/no-unnecessary-condition -- Validate untrusted runtime objects, not just the declared union.
}

/** Identifies virtual descendants without claiming another product's virtual resources. */
export function isFunctionAppVirtualNode(node: unknown): node is FunctionAppVirtualNode {
    return !!node && typeof node === 'object'
        && 'virtualType' in node
        && (node.virtualType === FunctionAppVirtualTypes.Functions
            || node.virtualType === FunctionAppVirtualTypes.Function
            || node.virtualType === FunctionAppVirtualTypes.Invalid)
        && 'virtualPath' in node && typeof node.virtualPath === 'string'
        && 'azureResource' in node && isFunctionApp(node.azureResource);
}
