/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ESLint configuration for the VS Code extension package.
 *
 * Extends the shared strict type-checked config and forbids direct runtime
 * imports of the `vscode` module in product code -- the VS Code API must be
 * passed down as `IVsCode` so shared packages remain runtime-independent of
 * VS Code. Type-only imports are allowed.
 */

import { azExtEslintStrictTypeChecked } from '@microsoft/vscode-azext-eng/eslint'; // Other configurations exist
import { defineConfig } from 'eslint/config';

export default defineConfig([
    azExtEslintStrictTypeChecked,
    {
        // `playwright.config.ts` and the UI tests under `test/ui/` are type-checked
        // by `test/ui/tsconfig.json` (they need DOM lib types); point the linter's
        // project service at that config so it can parse them.
        files: ['playwright.config.ts', 'test/ui/**/*.ts'],
        languageOptions: {
            parserOptions: {
                project: './test/ui/tsconfig.json',
                projectService: false,
            },
        },
    },
    {
        ignores: ['test/**'],
        rules: {
            '@typescript-eslint/no-restricted-imports': ['error', {
                paths: [
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
