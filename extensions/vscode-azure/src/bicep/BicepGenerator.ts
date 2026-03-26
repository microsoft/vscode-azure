/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface FunctionAppBicepOptions {
    readonly functionAppName: string;
    readonly runtime: FunctionAppRuntime;
    readonly hostingPlan: FunctionAppHostingPlan;
}

export type FunctionAppRuntime = 'dotnet-isolated' | 'node' | 'python' | 'java' | 'powershell' | 'custom';

export type FunctionAppHostingPlan = 'FlexConsumption' | 'Premium' | 'AppServicePlan';

/**
 * The directory containing the Function App Bicep templates relative
 * to the extension root. Contains `functionApp.bicep` (the main
 * entry) and `function-app.bicep` (the module).
 */
export const FunctionAppTemplateDir = 'resources/templates';

/**
 * ARM deployment parameters schema used by azd.
 */
const parametersSchema = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#';

/** Maps a runtime to its default version string for linuxFxVersion. */
function getRuntimeVersion(runtime: FunctionAppRuntime): string {
    switch (runtime) {
        case 'node': return 'Node|20';
        case 'python': return 'Python|3.11';
        case 'dotnet-isolated': return 'DOTNET-ISOLATED|8.0';
        case 'java': return 'Java|17';
        case 'powershell': return 'PowerShell|7.4';
        case 'custom': return 'custom';
    }
}

/**
 * Generates an ARM-style `main.parameters.json` that supplies
 * concrete values to the Function App main Bicep template. Uses azd
 * placeholders for environment name and location.
 */
export function generateFunctionAppParameters(options: FunctionAppBicepOptions): string {
    const parameters: Record<string, { value: string }> = {
        environmentName: { value: '${AZURE_ENV_NAME}' }, // eslint-disable-line no-template-curly-in-string -- azd placeholder
        location: { value: '${AZURE_LOCATION}' }, // eslint-disable-line no-template-curly-in-string -- azd placeholder
        functionAppName: { value: options.functionAppName },
        hostingPlan: { value: options.hostingPlan },
        runtimeStack: { value: options.runtime },
        runtimeVersion: { value: getRuntimeVersion(options.runtime) },
    };

    const doc = {
        $schema: parametersSchema,
        contentVersion: '1.0.0.0',
        parameters,
    };

    return JSON.stringify(doc, undefined, 2) + '\n';
}
