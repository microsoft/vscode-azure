/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ESLint configuration for the `utils` package.
 *
 * Extends the shared strict type-checked config and enforces:
 * - Only `ServiceIdentifier` type imports from `inversify` (keeps the
 *   package DI-agnostic at runtime).
 * - Only type imports of `vscode` and `@vscode/extension-telemetry` (these
 *   are passed down from the extension so shared code stays runtime-free
 *   of VS Code).
 * - `@azure/*` packages must be lazily imported inside functions to reduce
 *   extension activation time. `@azure/core-process` is exempt: it is tiny,
 *   dependency-free, and is a thin `node:child_process` wrapper needed
 *   eagerly by {@linkcode ProcessExecutor}.
 */

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
                    group: ['@azure/*', '!@azure/core-process'],
                    message: 'Please lazily import this package within the function that uses it to reduce extension activation time.',
                    allowTypeImports: true,
                }],
            }],
        },
    },
]);
