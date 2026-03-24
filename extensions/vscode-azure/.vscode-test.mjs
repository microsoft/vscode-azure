/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { azExtSrcTestConfig } from '@microsoft/vscode-azext-eng/vscode-test';
import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
    tests: [azExtSrcTestConfig],
    coverage: {
        reporter: ['html'],
        exclude: ['**/packages/**', '**/extensions/vscode-azure/dist/**'],
    },
});
