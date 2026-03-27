/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { autoEsbuildOrWatch, autoSelectEsbuildConfig } from '@microsoft/vscode-azext-eng/esbuild';

const { extensionConfig, telemetryConfig } = autoSelectEsbuildConfig(true);

// These cause files in these packages to be resolved correctly by esbuild
extensionConfig.alias = {
    ...extensionConfig.alias,
    '@microsoft/vscode-azure-utils': '../../packages/utils/src/index.ts',
    '@microsoft/vscode-azure-azutils': '../../packages/azutils/src/index.ts',
    '@microsoft/vscode-azure-azutils/testing': '../../packages/azutils/src/testing.ts',
};

// Add a separate entry point for the debug mock data bundle so it does not
// pollute the main extension bundle.
extensionConfig.entryPoints.push({
    in: './src/debug/mockData.ts',
    out: 'debug.bundle',
});

await autoEsbuildOrWatch({ extensionConfig, telemetryConfig });
