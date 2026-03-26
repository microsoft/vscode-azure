/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import type { FunctionAppHostingPlan, FunctionAppRuntime } from '../../bicep/BicepGenerator';

/** User's choice at the "offer save" prompt step. */
export type SaveOrDeployChoice = 'save' | 'deploy' | 'saveAndDeploy';

/** Accumulated wizard context for Function App creation. */
export interface CreateFunctionAppContext {
    readonly subscription: AzureSubscription;
    readonly resourceGroupName: string;
    readonly functionAppName: string;
    readonly region: string;
    readonly runtime: FunctionAppRuntime;
    readonly hostingPlan: FunctionAppHostingPlan;
    readonly saveOrDeploy: SaveOrDeployChoice;
    readonly parametersContent: string;
    readonly azureYamlContent: string;
    readonly projectDir: string;
}
