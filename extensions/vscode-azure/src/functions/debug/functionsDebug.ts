/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Debugger identity shared by launch configurations, commands, and provider registration. */
export const FunctionsDebugType = 'azure-functions';

/** Worker stacks supported by the local attach flow. */
export type FunctionsDebugRuntime = 'node' | 'python' | 'java' | 'powershell' | 'dotnet-isolated' | 'native';

/** Identifies supported worker stacks without offering an attach action for custom handlers. */
export function isFunctionsDebugRuntime(runtime: unknown): runtime is FunctionsDebugRuntime {
    return runtime === 'node' || runtime === 'python' || runtime === 'java' || runtime === 'powershell' || runtime === 'dotnet-isolated' || runtime === 'native';
}
