/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// This is the extension entrypoint, which imports extension.bundle.js, the actual extension code.
//
// This is in a separate file so we can properly measure extension.bundle.js load time.

// @ts-check

/** @type {import('vscode').ExtensionMode.Production} */
const extensionModeProduction = 1;

const fs = require('fs');
const path = require('path');

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
 * - `AZURE_MOCK_DATA=1` rebinds services with mock data so the tree views render
 *   deterministic fake data.
 * - `ENABLE_LONG_RUNNING_TESTS=1` injects a real Azure credential factory so the in-process
 *   AzdAuthServer can acquire live tokens without an interactive sign-in.
 *
 * @param {import('vscode').ExtensionContext} ctx
 */
exports.activate = async function activate(ctx) {
    const overrideBundlePath = resolveOverrideBundlePath(ctx);
    if (overrideBundlePath) {
        const { applyOverrides } = require(overrideBundlePath);
        return extension.activateInternal(ctx, perfStats, applyOverrides);
    }

    return await extension.activateInternal(ctx, perfStats);
}

/**
 * Picks the container-override bundle to load, if any.
 *
 * Overrides normally only apply outside of `ExtensionMode.Production`. The
 * Playwright web harness is the one exception: it has to *install* the extension
 * (released VS Code servers reject `--extensionDevelopmentPath`), which forces
 * production mode. Falling back to an on-disk check is safe because
 * `.vscodeignore` keeps `dist/test/**` out of every package, so a published
 * build can never satisfy it no matter how the environment is set.
 *
 * @param {import('vscode').ExtensionContext} ctx
 * @returns {string | undefined} A `require`-able path, or `undefined` for no overrides.
 */
function resolveOverrideBundlePath(ctx) {
    /** @type {string | undefined} */
    let overrideBundlePath;
    if (process.env.AZURE_MOCK_DATA === '1') {
        overrideBundlePath = './dist/test/mock.bundle.js';
    } else if (process.env.ENABLE_LONG_RUNNING_TESTS === '1') {
        overrideBundlePath = './dist/test/e2e.bundle.js';
    }

    if (!overrideBundlePath || ctx.extensionMode !== extensionModeProduction) {
        return overrideBundlePath;
    }

    return fs.existsSync(path.join(__dirname, overrideBundlePath)) ? overrideBundlePath : undefined;
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

perfStats.loadEndTime = Date.now();
