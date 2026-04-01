/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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

/**
 * Display labels for Function App virtual nodes.
 */
export const FunctionAppLabels = {
    AppSettings: 'App Settings',
} as const;
