/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * `@vscode/test-cli` configuration for running integration tests against a
 * downloaded VS Code. Coverage is collected for `src/**` excluding the test
 * folder and emitted as HTML.
 */

import { createVscodeTestConfig } from '@microsoft/vscode-azext-eng/vscode-test';
import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
    tests: [createVscodeTestConfig({ mocha: { ui: 'bdd' } })],
    coverage: {
        include: [
            '**/extensions/vscode-azure/src/**',
            // '**/extensions/vscode-azure/dist/extension.bundle.*',
            // Uncommenting above, to include the bundle, scans more source files (e.g. extension.ts)
            // that aren't covered by unit tests, however, it also includes a lot of dependency files,
            // and `exclude` doesn't seem to filter those out
            // It is also necessary to ensure source maps are enabled, and minification disabled in
            // the esbuild config (see esbuild.mjs)
        ],
        exclude: [
            '**/extensions/vscode-azure/test/**',
        ],
        reporter: ['html'],
        output: 'coverage',
    },
});
