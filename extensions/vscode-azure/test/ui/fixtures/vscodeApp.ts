/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Playwright fixtures that hand a spec a ready-to-drive VS Code workbench with
 * this extension loaded and mock Azure data enabled.
 *
 * The same specs run in two modes, selected by the `vscodeMode` project option:
 * - `electron` launches the real desktop VS Code with `_electron.launch()`.
 *   Electron has no headless mode, so a window appears; it closes itself.
 * - `web` points Chromium at the VS Code server started by
 *   {@linkcode startVSCodeServer} -- the same surface the `ui:serve` harness
 *   exposes for interactive use.
 *
 * Traces and screenshots are captured manually here rather than through
 * `use: { trace, screenshot }`, because those only apply to Playwright's
 * built-in `page`/`context` fixtures.
 */

import { _electron as electron, test as base, type ElectronApplication, type Page, type TestInfo } from '@playwright/test';
import * as path from 'node:path';
import { extensionRoot, mockDataEnv, removeUiTempDir, uiTempDir, uiWorkspacePath } from './paths';
import { resolveVSCodeExecutable } from './vscodeExecutable';
import { startVSCodeServer, type VSCodeServer } from './vscodeServer';
import { Workbench } from './workbench';

/** Project-level options for the UI suite. */
export interface VSCodeTestOptions {
    /** Which VS Code host the specs run against. Set per Playwright project. */
    vscodeMode: 'electron' | 'web';
}

/** Fixtures available to UI specs. */
export interface VSCodeFixtures {
    /** The workbench page (an Electron window, or a browser tab served by the VS Code server). */
    workbench: Page;
    /** Helpers for driving the workbench (commands, views, tree items). */
    wb: Workbench;
}

interface WorkerFixtures {
    /** The VS Code server, started once per worker. Only used by the `web` project. */
    vscodeServer: VSCodeServer | undefined;
}

/**
 * Command-line arguments for the desktop VS Code instance.
 *
 * A per-test `--user-data-dir` keeps each test from inheriting settings written
 * by an earlier one (the Group By command persists a global setting), and keeps
 * a developer's real profile -- including any `vscode-azure.selectedSubscriptions`
 * filter that would hide the mock subscription -- out of the picture. The empty
 * `--extensions-dir` is what isolates the run from installed extensions;
 * `--disable-extensions` is deliberately not used, because it raises a
 * notification toast that can cover the workbench.
 */
function electronArgs(userDataDir: string, extensionsDir: string): string[] {
    return [
        `--extensionDevelopmentPath=${extensionRoot}`,
        `--user-data-dir=${userDataDir}`,
        `--extensions-dir=${extensionsDir}`,
        '--disable-updates',
        '--disable-telemetry',
        '--disable-workspace-trust',
        '--disable-crash-reporter',
        '--skip-welcome',
        '--skip-release-notes',
        '--no-cached-data',
        uiWorkspacePath,
    ];
}

/** Launches desktop VS Code and returns its main window once the workbench has rendered. */
async function launchElectron(): Promise<{ app: ElectronApplication; page: Page; tempDirs: string[] }> {
    const executablePath = await resolveVSCodeExecutable();

    // `ELECTRON_RUN_AS_NODE` is set when Playwright itself runs under Electron-ish
    // tooling; leaving it set would start VS Code as a bare Node process.
    const env = { ...process.env, ...mockDataEnv };
    delete env.ELECTRON_RUN_AS_NODE;

    const tempDirs = [uiTempDir('user-data'), uiTempDir('extensions')];

    const app = await electron.launch({
        executablePath,
        args: electronArgs(tempDirs[0], tempDirs[1]),
        env: env as Record<string, string>,
        timeout: 120_000,
    });

    const page = await app.firstWindow();
    return { app, page, tempDirs };
}

/** Attaches a screenshot, and a trace when one was recorded, to the test report. */
async function captureFailureArtifacts(page: Page, testInfo: TestInfo): Promise<void> {
    if (testInfo.status === testInfo.expectedStatus) {
        return;
    }

    try {
        const screenshotPath = testInfo.outputPath('workbench.png');
        await page.screenshot({ path: screenshotPath });
        await testInfo.attach('workbench', { path: screenshotPath, contentType: 'image/png' });
    } catch {
        // The window may already be gone; a missing screenshot must not mask the real failure.
    }
}

export const test = base.extend<VSCodeFixtures, VSCodeTestOptions & WorkerFixtures>({
    vscodeMode: ['electron', { option: true, scope: 'worker' }],

    vscodeServer: [async ({ vscodeMode }, use) => {
        if (vscodeMode !== 'web') {
            await use(undefined);
            return;
        }

        const server = await startVSCodeServer();
        await use(server);
        await server.stop();
    }, { scope: 'worker', timeout: 300_000 }],

    workbench: async ({ vscodeMode, vscodeServer, browser }, use, testInfo) => {
        let app: ElectronApplication | undefined;
        let page: Page;
        let tempDirs: string[] = [];

        if (vscodeMode === 'electron') {
            ({ app, page, tempDirs } = await launchElectron());
        } else {
            const server = vscodeServer;
            if (!server) {
                throw new Error('The web project requires a running VS Code server.');
            }

            const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
            page = await context.newPage();
            // No folder: a served folder opens in Restricted Mode, which disables the extension.
            await page.goto(server.workbenchUrl(), { waitUntil: 'domcontentloaded' });
        }

        const tracing = page.context().tracing;
        await tracing.start({ screenshots: true, snapshots: true, title: testInfo.title });

        await page.waitForSelector('.monaco-workbench', { timeout: 120_000 });

        await use(page);

        await captureFailureArtifacts(page, testInfo);

        const tracePath = path.join(testInfo.outputDir, 'trace.zip');
        await tracing.stop(testInfo.status === testInfo.expectedStatus ? {} : { path: tracePath });
        if (testInfo.status !== testInfo.expectedStatus) {
            await testInfo.attach('trace', { path: tracePath, contentType: 'application/zip' });
        }

        if (app) {
            await app.close();
        } else {
            await page.context().close();
        }

        for (const dir of tempDirs) {
            removeUiTempDir(dir);
        }
    },

    wb: async ({ workbench }, use) => {
        const helper = new Workbench(workbench);
        await helper.waitForExtensionActivation();
        await use(helper);
    },
});

export { expect } from '@playwright/test';
