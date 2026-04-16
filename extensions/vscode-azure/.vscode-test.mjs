/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { azExtSrcTestConfig } from '@microsoft/vscode-azext-eng/vscode-test'; // Other configurations exist
import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
    // TODO: remove version pin once the transient VS Code build issue is resolved
    tests: [{
        ...azExtSrcTestConfig,
        version: '1.116.0',
        download: { timeout: 120_000 },
    }],
    // tests: [azExtSrcTestConfig],
    coverage: {
        include: [
            '**/extensions/vscode-azure/src/**'
        ],
        exclude: [
            '**/extensions/vscode-azure/src/test/**',
        ],
        reporter: ['html'],
        output: 'coverage',
    },
});
