/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { GenericResource, VirtualResource } from '@microsoft/vscode-azure-azutils';
import { FunctionAppLogicalType, isGenericResource, isVirtualResource } from '@microsoft/vscode-azure-azutils';

/**
 * Virtual-type identifiers used by Function App tree nodes.
 *
 * Centralised here so that data providers, view providers, and commands
 * all reference the same constants rather than duplicating string literals.
 */
export const FunctionAppVirtualTypes = {
    /** The "App Settings" category node. */
    AppSettings: 'functionApp.appSettings',
    /** An individual app-setting leaf node. */
    AppSetting: 'functionApp.appSetting',
} as const;

const knownVirtualTypes = new Set<string>([FunctionAppVirtualTypes.AppSettings, FunctionAppVirtualTypes.AppSetting]);

/**
 * Virtual-path identifiers used as node keys in the data/view tree.
 *
 * These are structural identifiers, not display labels.
 * Display text is localised separately in the view provider via `l10n.t()`.
 */
export const FunctionAppVirtualPaths = {
    AppSettings: 'App Settings',
} as const;

/**
 * Type guard that narrows an unknown value to a Function App {@linkcode GenericResource}.
 *
 * Returns `true` for `GenericResource` nodes whose `logicalType` matches
 * `Microsoft.Web/sites~functionapp` (case-insensitive).
 */
export function isFunctionApp(node: unknown): node is GenericResource {
    return !!node && typeof node === 'object' && isGenericResource(node as GenericResource)
        && (node as GenericResource).logicalType.toLowerCase() === FunctionAppLogicalType.toLowerCase();
}

/**
 * Type guard for Function App-owned {@linkcode VirtualResource} nodes
 * with a known virtual type.
 */
export function isFunctionAppVirtual(node: unknown): node is VirtualResource {
    return !!node && typeof node === 'object'
        && isVirtualResource(node as VirtualResource)
        && knownVirtualTypes.has((node as VirtualResource).virtualType)
        && isFunctionApp((node as VirtualResource).azureResource);
}
