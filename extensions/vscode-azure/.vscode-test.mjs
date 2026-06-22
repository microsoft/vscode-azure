/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * `@vscode/test-cli` configuration for running integration tests against a
 * downloaded VS Code. Coverage is collected for `src/**` excluding the test
 * folder and emitted as HTML.
 */

import { azExtSrcTestConfig } from '@microsoft/vscode-azext-eng/vscode-test'; // Other configurations exist
import { defineConfig } from '@vscode/test-cli';

// The vscode-test runner defaults mocha to the TDD interface (suite/test), but
// the rest of the repo (and @types/mocha) uses the BDD interface (describe/it).
// Force BDD so the global describe/it are available without importing them.
azExtSrcTestConfig.mocha.ui = 'bdd';

export default defineConfig({
    tests: [azExtSrcTestConfig],
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
            '**/extensions/vscode-azure/src/override/**',
            '**/extensions/vscode-azure/src/test/**',
        ],
        reporter: ['html'],
        output: 'coverage',
    },
});
