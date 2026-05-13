/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PickContext } from '@microsoft/vscode-azure-utils';
import type { AzdWizardContext } from '../../azd/wizard/AzdWizardContext';

/** Accumulated wizard context for Function App creation. */
export interface CreateFunctionAppContext extends AzdWizardContext, PickContext<string> {
    readonly functionWorkerRuntime?: string;
    readonly runtimeVersion?: string;
    readonly appServicePlanSkuName?: AppServicePlanSku;
}

/** SKU values offered by {@linkcode PickHostingPlanStep}. */
export type AppServicePlanSku = 'FC1' | 'EP1' | 'S1';

/** Runtime stacks offered by {@linkcode PickRuntimeStep}. */
export type FunctionAppRuntime = 'dotnet-isolated' | 'node' | 'python' | 'java' | 'powershell' | 'custom';
