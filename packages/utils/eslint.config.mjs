/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { azExtEslintStrictTypeChecked } from '@microsoft/vscode-azext-eng/eslint'; // Other configurations exist
import { defineConfig } from 'eslint/config';

export default defineConfig([
    azExtEslintStrictTypeChecked,
    {
        rules: {
            '@typescript-eslint/no-restricted-imports': ['error', {
                paths: [
                    {
                        name: 'inversify',
                        message: 'Only type imports of ServiceIdentifier are allowed from inversify in this package. Use: import type { ServiceIdentifier } from \'inversify\';',
                        allowImportNames: ['ServiceIdentifier'],
                    },
                    {
                        name: 'vscode',
                        message: 'vscode should only be used for typings in this package. Pass it down from the caller as IVsCode.',
                        allowTypeImports: true,
                    },
                    {
                        name: '@vscode/extension-telemetry',
                        message: '@vscode/extension-telemetry should only be used for typings in this package. Pass it down from the caller.',
                        allowTypeImports: true,
                    }
                ],
                patterns: [{
                    group: ['@azure/*', '!@azure/ms-rest-azure-env'],
                    message: 'Please lazily import this package within the function that uses it to reduce extension activation time.',
                    allowTypeImports: true,
                }],
            }],
        },
    },
]);
