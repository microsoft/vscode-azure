/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { FunctionWorkerRuntime } from '../CreateFunctionAppContext';

/**
 * Supported (non-EOL) runtime versions offered for each {@linkcode FunctionWorkerRuntime},
 * ordered newest-first. The first entry is treated as the default. `custom` carries a single
 * empty version because the user supplies their own handler.
 *
 * This is the single source of truth consumed by {@linkcode PickRuntimeStep} (to auto-assign a
 * version when only one is supported) and {@linkcode PickRuntimeVersionStep} (to prompt when more
 * than one is supported).
 *
 * The list is curated, not exhaustive.
 */
export const runtimeVersions = {
    node: ['26', '24'], // https://versionlog.com/nodejs/
    python: ['3.14', '3.12'], // https://versionlog.com/python/
    'dotnet-isolated': ['10.0'], // https://versionlog.com/dotnet-core/
    java: ['25', '21'], // https://versionlog.com/java/
    powershell: ['7.6'], // https://learn.microsoft.com/en-us/powershell/scripting/install/powershell-support-lifecycle
    custom: [''],
} as const satisfies Record<FunctionWorkerRuntime, readonly string[]>;
