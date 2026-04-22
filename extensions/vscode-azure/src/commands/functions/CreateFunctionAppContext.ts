/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PickContext } from '@microsoft/vscode-azure-utils';
import type { AzdWizardContext } from '../../azd/wizard/AzdWizardContext';

/** Accumulated wizard context for Function App creation. */
export interface CreateFunctionAppContext extends AzdWizardContext, PickContext<string> {
    readonly functionAppName?: string;
    readonly runtime?: FunctionAppRuntime;
    readonly runtimeVersion?: string;
    readonly hostingPlan?: FunctionAppHostingPlan;
}

/** Hosting plan flavors offered by {@linkcode PickHostingPlanStep}. */
export type FunctionAppHostingPlan = 'FlexConsumption' | 'Premium' | 'AppServicePlan';

/** Runtime stacks offered by {@linkcode PickRuntimeStep}. */
export type FunctionAppRuntime = 'dotnet-isolated' | 'node' | 'python' | 'java' | 'powershell' | 'custom';

/**
 * Returns the `runtimeVersion` string expected by the Function App bicep
 * template for the given runtime (e.g., `Node|20`, `Python|3.11`).
 */
export function getRuntimeVersion(runtime: FunctionAppRuntime): string {
    switch (runtime) {
        case 'node': return 'Node|20';
        case 'python': return 'Python|3.11';
        case 'dotnet-isolated': return 'DOTNET-ISOLATED|8.0';
        case 'java': return 'Java|17';
        case 'powershell': return 'PowerShell|7.4';
        case 'custom': return 'custom';
    }
}
