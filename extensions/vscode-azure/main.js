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
 * - `ENABLE_LONG_RUNNING_TESTS=1` injects a real Azure credential factory so the in-process
 *   AzdAuthServer can acquire live tokens without an interactive sign-in.
 *
 * @param {import('vscode').ExtensionContext} ctx
 */
exports.activate = async function activate(ctx) {
    if (ctx.extensionMode !== extensionModeProduction) {
        let overrideBundlePath;
        if (process.env.AZURE_MOCK_DATA === '1') {
            overrideBundlePath = './dist/test/mock.bundle.js';
        } else if (process.env.ENABLE_LONG_RUNNING_TESTS === '1') {
            overrideBundlePath = './dist/test/e2e.bundle.js';
        }

        if (overrideBundlePath) {
            const { applyOverrides } = require(overrideBundlePath);
            return extension.activateInternal(ctx, perfStats, applyOverrides);
        }
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

perfStats.loadEndTime = Date.now();
