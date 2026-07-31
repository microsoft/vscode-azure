/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Interactive UI harness: serves this extension inside a browser-hosted VS Code
 * workbench and keeps it running until interrupted.
 *
 *     pnpm --filter vscode-azure run ui:serve
 *
 * Prints the workbench URL on a single `VSCODE_AZURE_UI_URL=<url>` line so an
 * agent (or a human) can grab it and open it with browser tooling, then click
 * through the Azure views backed by mock data.
 */

import { startVSCodeServer } from './fixtures/vscodeServer';

async function main(): Promise<void> {
    const port = Number(process.env.VSCODE_AZURE_UI_PORT ?? 0);
    const verbose = process.env.VSCODE_AZURE_UI_VERBOSE === '1';

    const server = await startVSCodeServer({
        port: Number.isFinite(port) ? port : 0,
        onOutput: text => {
            if (verbose) {
                process.stderr.write(text);
            }
        },
    });

    console.log(`VSCODE_AZURE_UI_URL=${server.workbenchUrl()}`);
    console.log('Serving the Azure extension with mock data (AZURE_MOCK_DATA=1). Press Ctrl+C to stop.');

    let stopping = false;
    const stop = () => {
        if (stopping) {
            return;
        }
        stopping = true;
        void server.stop().then(() => process.exit(0));
    };

    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
}

void main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
