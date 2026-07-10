/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * esbuild build script for the VS Code extension.
 *
 * Aliases the workspace-local `@microsoft/vscode-azure-utils` and
 * `@microsoft/vscode-azure-azutils` packages so esbuild resolves them from
 * source (no prebuild step required), and adds secondary `test/mock.bundle`
 * and `test/e2e.bundle` entry points that ship the mock-data bindings and the
 * E2E credential override separately from the main extension bundle.
 */

import { autoEsbuildOrWatch, autoSelectEsbuildConfig } from '@microsoft/vscode-azext-eng/esbuild';
import { copy } from 'esbuild-plugin-copy';

const { extensionConfig, telemetryConfig } = autoSelectEsbuildConfig();

// These cause files in these packages to be resolved correctly by esbuild
extensionConfig.alias = {
    ...extensionConfig.alias,
    '@microsoft/vscode-azure-utils': '../../packages/utils/src/index.ts',
    '@microsoft/vscode-azure-azutils': '../../packages/azutils/src/index.ts',
    '@microsoft/vscode-azure-azutils/testing': '../../packages/azutils/test/testing.ts',
};

// Copy Azure resource type icons into dist/azureIcons/ so they are bundled
// with the extension and cleaned up automatically by `pnpm run clean`.
extensionConfig.plugins.push(
    copy({
        assets: [
            {
                from: '../../packages/azutils/resources/azureIcons/**/*.svg',
                to: './azureIcons',
            },
        ],
    }),
);

// Add a separate entry point for the mock data bundle so it does not
// pollute the main extension bundle. Only loaded by `main.js` when
// `AZURE_MOCK_DATA=1`, and non-production mode.
extensionConfig.entryPoints.push({
    in: './src/override/mock.ts',
    out: 'test/mock.bundle',
});

// Add a separate entry point for the E2E credential override bundle so its
// `@azure/identity` dependency stays out of the main extension bundle. Only
// loaded by `main.js` when `ENABLE_LONG_RUNNING_TESTS=1`, and non-production mode.
extensionConfig.entryPoints.push({
    in: './src/override/e2e.ts',
    out: 'test/e2e.bundle',
});

await autoEsbuildOrWatch({ extensionConfig, telemetryConfig });
