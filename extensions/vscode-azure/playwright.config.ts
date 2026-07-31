/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Playwright configuration for the UI (workbench) tests in `test/ui/`.
 *
 * Two projects run the same specs against the same extension build:
 * - `electron` (default) drives a real desktop VS Code via `_electron.launch()`.
 * - `web` drives the same extension hosted by the VS Code *server* build in a
 *   Chromium page -- the same surface the interactive `ui:serve` harness exposes.
 *
 * Specs are named `*.spec.ts` on purpose: the `@vscode/test-cli` mocha runner
 * globs `test/ ** / *.test.ts`, so this naming keeps the two suites from
 * colliding.
 */

import { defineConfig } from '@playwright/test';
import type { VSCodeTestOptions } from './test/ui/fixtures/vscodeApp';

export default defineConfig<object, VSCodeTestOptions>({
    testDir: './test/ui',
    testMatch: '**/*.spec.ts',

    // A VS Code instance is expensive and the shared `.vscode-test` profile is
    // not safe to use concurrently, so keep the suite strictly serial.
    workers: 1,
    fullyParallel: false,

    timeout: 3 * 60 * 1000,
    expect: { timeout: 20 * 1000 },

    forbidOnly: !!process.env.CI,
    retries: 0,

    outputDir: 'test-results/artifacts',
    reporter: [
        ['list'],
        ['json', { outputFile: 'test-results/results.json' }],
        ['html', { outputFolder: 'test-results/html', open: 'never' }],
    ],

    projects: [
        {
            name: 'electron',
            use: { vscodeMode: 'electron' },
        },
        {
            name: 'web',
            use: { vscodeMode: 'web' },
        },
    ],
});
