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
 * This is the single source of truth consumed by {@linkcode PickRuntimeVersionStep}, which
 * resolves the runtime version by auto-assigning it when only one is supported and prompting when
 * more than one is supported.
 *
 * The list is curated, not exhaustive.
 */
export const runtimeVersions = {
    node: ['24', '22'], // https://learn.microsoft.com/en-us/azure/azure-functions/functions-versions?pivots=programming-language-typescript#languages
    python: ['3.12'], // https://learn.microsoft.com/en-us/azure/azure-functions/functions-versions?pivots=programming-language-python#languages
    'dotnet-isolated': ['10.0'], // https://learn.microsoft.com/en-us/azure/azure-functions/functions-versions?pivots=programming-language-csharp#languages
    java: ['25', '21'], // https://learn.microsoft.com/en-us/azure/azure-functions/functions-versions?pivots=programming-language-java#languages
    powershell: ['7.4'], // https://learn.microsoft.com/en-us/azure/azure-functions/functions-versions?pivots=programming-language-powershell#languages
    custom: [''],
} as const satisfies Record<FunctionWorkerRuntime, readonly string[]>;
