/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import type { Location } from '@microsoft/vscode-azure-azutils';
import type { FunctionAppHostingPlan, FunctionAppRuntime } from '../../bicep/BicepGenerator';

/** Accumulated wizard context for Function App creation. */
export interface CreateFunctionAppContext {
    readonly subscription: AzureSubscription;
    readonly location: Location;
    readonly environmentName: string;
    readonly functionAppName: string;
    readonly runtime: FunctionAppRuntime;
    readonly hostingPlan: FunctionAppHostingPlan;
    readonly deploy: boolean;
    parametersContent: string;
    azureYamlContent: string;
    projectDir: string;
}
