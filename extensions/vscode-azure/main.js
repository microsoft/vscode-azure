/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// This is the extension entrypoint, which imports extension.bundle.js, the actual extension code.
//
// This is in a separate file so we can properly measure extension.bundle.js load time.

const perfStats = {
    loadStartTime: Date.now(),
    loadEndTime: undefined
};

const extension = require('./dist/extension.bundle.js');

/**
 * VS Code extension activation entry point.
 *
 * When `AZURE_MOCK_DATA=1` is set and the extension is running in Development
 * mode, mock bindings from `debug.bundle.js` are applied to the DI container
 * before activation so the tree views render deterministic fake data.
 *
 * @param {import('vscode').ExtensionContext} ctx
 */
exports.activate = async function activate(ctx) {
    // ExtensionMode.Development === 2
    if (process.env.AZURE_MOCK_DATA === '1' && ctx.extensionMode === 2) {
        const { applyMockData } = require('./dist/debug.bundle.js');
        return await extension.activateInternal(ctx, perfStats, applyMockData);
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
