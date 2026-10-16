/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PickContext } from '@microsoft/vscode-azure-utils';
import type { AzdWizardContext } from '../../azd/wizard/AzdWizardContext';

/** Accumulated wizard context for Function App creation. */
export interface CreateFunctionAppContext extends AzdWizardContext, PickContext<string> {
    /** Always set; shared prompts name the product rather than assuming one. */
    readonly resourceDisplayName: string;
    readonly functionWorkerRuntime?: FunctionWorkerRuntime;
    readonly runtimeVersion?: string;
}

/** Runtime stacks offered by {@linkcode PickRuntimeStep}. */
export type FunctionWorkerRuntime = 'dotnet-isolated' | 'node' | 'python' | 'java' | 'powershell';
