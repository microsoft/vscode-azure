/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Paths and environment shared by every UI-test entry point (the Playwright
 * fixtures and the `ui:serve` harness).
 */

import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Absolute path to the extension root (the folder holding `package.json`/`main.js`).
 *
 * `__dirname` rather than `import.meta.url`: Playwright transpiles specs and
 * their imports to CommonJS, where `import.meta` is a syntax error.
 */
export const extensionRoot = path.resolve(__dirname, '..', '..', '..');

/**
 * Download cache for VS Code desktop and server builds.
 *
 * Deliberately the same `.vscode-test` directory `@vscode/test-cli` uses, so
 * `pnpm run link-test-cache` keeps sharing one download across worktrees.
 */
export const testCachePath = path.join(extensionRoot, '.vscode-test');

/** Folder opened by the UI tests, so the workbench starts in a known state. */
export const uiWorkspacePath = path.join(extensionRoot, 'test', 'ui', 'workspace');

/**
 * Environment applied to every VS Code instance launched for UI tests.
 *
 * `AZURE_MOCK_DATA` makes `main.js` load `dist/test/mock.bundle.js`, which
 * rebinds the Azure providers to deterministic fake data (see
 * `test/override/mock.ts`), so the tests need no Azure auth and no network.
 */
export const mockDataEnv: Readonly<Record<string, string>> = {
    /* eslint-disable @typescript-eslint/naming-convention -- environment variable names */
    AZURE_MOCK_DATA: '1',
    DEBUGTELEMETRY: '1',
    VSCODE_RUNNING_TESTS: '1',
    /* eslint-enable @typescript-eslint/naming-convention */
};

/** Prefix shared by every throwaway directory the UI tests create. */
const tempDirPrefix = 'vscode-azure-ui-';

/** Age after which a leftover temp directory is assumed to be abandoned. */
const staleTempDirAge = 6 * 60 * 60 * 1000;

/** Creates a throwaway directory under the OS temp dir, prefixed for easy identification. */
export function uiTempDir(prefix: string): string {
    sweepStaleUiTempDirs();
    return mkdtempSync(path.join(os.tmpdir(), `${tempDirPrefix}${prefix}-`));
}

/**
 * Removes long-abandoned temp directories left by earlier runs.
 *
 * Teardown removal is best-effort (see {@linkcode removeUiTempDir}), so without
 * this sweep a machine slowly accumulates multi-hundred-megabyte VS Code
 * profiles. Only directories untouched for {@linkcode staleTempDirAge} are
 * removed, so a long-running `ui:serve` harness is never disturbed.
 */
function sweepStaleUiTempDirs(): void {
    const cutoff = Date.now() - staleTempDirAge;
    let entries: string[];

    try {
        entries = readdirSync(os.tmpdir());
    } catch {
        return;
    }

    for (const entry of entries) {
        if (!entry.startsWith(tempDirPrefix)) {
            continue;
        }

        const dir = path.join(os.tmpdir(), entry);
        try {
            if (statSync(dir).mtimeMs < cutoff) {
                removeUiTempDir(dir);
            }
        } catch {
            // Raced with another run removing the same directory.
        }
    }
}

/**
 * Best-effort removal of a directory created by {@linkcode uiTempDir}.
 *
 * Called during teardown so repeated runs do not fill the temp directory with
 * multi-hundred-megabyte VS Code profiles. Failures are ignored: on Windows the
 * files may still be locked by a process that has only just exited, and that
 * must never fail a test.
 */
export function removeUiTempDir(dir: string): void {
    try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
        // Leaving a temp directory behind is not worth failing a run over.
    }
}
