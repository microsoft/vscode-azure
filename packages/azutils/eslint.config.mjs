/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ESLint configuration for the `azutils` package.
 *
 * Extends the shared strict type-checked config and enforces:
 * - Only `ServiceIdentifier` type imports from `inversify` (keeps the
 *   package DI-agnostic at runtime).
 * - Only type imports of `vscode` (pass the API down as `IVsCode`).
 *
 * Uses `tsconfig.lint.json` so the linter can resolve the sibling `utils`
 * package without requiring it to be built first.
 */

import { azExtEslintStrictTypeChecked } from '@microsoft/vscode-azext-eng/eslint'; // Other configurations exist
import { defineConfig } from 'eslint/config';

export default defineConfig([
    azExtEslintStrictTypeChecked,
    {
        languageOptions: {
            parserOptions: {
                projectService: false,
                project: './tsconfig.lint.json', // This tsconfig allows the linter to resolve the utils package without needing to build it first
            },
        },
    },
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
                        message: 'VSCode should only be used for typings in this package. Pass it down from the caller as IVsCode.',
                        allowTypeImports: true,
                    },
                ],
            }],
        },
    },
]);
