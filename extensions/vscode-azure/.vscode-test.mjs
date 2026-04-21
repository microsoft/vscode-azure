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

export default defineConfig({
    tests: [azExtSrcTestConfig],
    coverage: {
        include: [
            '**/extensions/vscode-azure/src/**'
        ],
        exclude: [
            '**/extensions/vscode-azure/src/debug/**',
            '**/extensions/vscode-azure/src/test/**',
        ],
        reporter: ['html'],
        output: 'coverage',
    },
});
