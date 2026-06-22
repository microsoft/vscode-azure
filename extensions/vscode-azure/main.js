/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// This is the extension entrypoint, which imports extension.bundle.js, the actual extension code.
//
// This is in a separate file so we can properly measure extension.bundle.js load time.

// @ts-check

/** @type {{ loadStartTime: number, loadEndTime: number }} */
const perfStats = {
    loadStartTime: Date.now(),
    loadEndTime: 0,
};

/** @type {typeof import('./src/extension')} */
const extension = require('./dist/extension.bundle.js');

/**
 * VS Code extension activation entry point.
 *
 * In specific dev/test scenarios, container overrides are applied before
 * activation by loading a separate bundle (see {@link activateWithOverrides}):
 * - `AZURE_MOCK_DATA=1` in Development mode rebinds services with mock data so
 *   the tree views render deterministic fake data.
 * - `RUN_E2E=1` injects a real Azure credential factory so the in-process
 *   AzdAuthServer can acquire live tokens without an interactive sign-in.
 *
 * @param {import('vscode').ExtensionContext} ctx
 */
exports.activate = async function activate(ctx) {
    // ExtensionMode.Development === 2
    if (process.env.AZURE_MOCK_DATA === '1' && ctx.extensionMode === 2) {
        return await activateWithOverrides(ctx, './dist/debug.bundle.js');
    }

    // RUN_E2E is only set by the E2E launch config / CI.
    if (process.env.RUN_E2E === '1') {
        return await activateWithOverrides(ctx, './dist/e2e.bundle.js');
    }

    return await extension.activateInternal(ctx, perfStats);
}

/**
 * VS Code extension deactivation entry point. Delegates to the bundled
 * extension's `deactivateInternal`.
 *
 * @param {import('vscode').ExtensionContext} ctx
 */
exports.deactivate = async function deactivate(ctx) {
    return await extension.deactivateInternal(ctx);
}

/**
 * Activates the extension after applying container overrides loaded from a
 * separate esbuild bundle. Each override bundle exports a common
 * `applyOverrides(container)` function (see `src/debug/mockData.ts` and
 * `src/debug/e2e.ts`). Kept out of the main bundle so their dev/test-only
 * dependencies do not ship in the VSIX.
 *
 * @param {import('vscode').ExtensionContext} ctx
 * @param {string} bundlePath - Path to the override bundle to require.
 */
function activateWithOverrides(ctx, bundlePath) {
    /** @type {{ applyOverrides: (container: import('inversify').Container) => void }} */
    const { applyOverrides } = require(bundlePath);
    return extension.activateInternal(ctx, perfStats, applyOverrides);
}

perfStats.loadEndTime = Date.now();
