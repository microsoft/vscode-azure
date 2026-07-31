/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Starts the VS Code **server (web) build** with this extension loaded from
 * source, so the workbench is reachable over http.
 *
 * This is what makes the extension drivable by tools that can only talk to a
 * browser page (Playwright's Chromium project, and Copilot's browser tools via
 * the `ui:serve` harness). The desktop `code serve-web` CLI is deliberately not
 * used: it only accepts `--cli-data-dir`/`--disable-telemetry`/`--telemetry-level`
 * and cannot load an extension at all.
 *
 * Released server builds also reject `--extensionDevelopmentPath`, so the
 * extension is packaged and installed instead -- see `harnessExtension.ts`.
 */

import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { installHarnessExtension, writeServerUserSettings, type ServerCommand } from './harnessExtension';
import { mockDataEnv, removeUiTempDir, testCachePath, uiTempDir } from './paths';

/** Milliseconds to wait for the server to print its "Web UI available at" banner. */
const serverStartTimeout = 180_000;

/** A running VS Code server, and the URL its workbench is served from. */
export interface VSCodeServer {
    /** Base workbench URL, as reported by the server. */
    readonly url: string;
    /**
     * Builds a workbench URL.
     *
     * Pass no folder (the default) to open an **empty window**. That is
     * deliberate: workspace trust in the browser lives in the browser's own
     * profile, so a served folder always opens in Restricted Mode, which
     * disables this extension entirely. Empty windows are always trusted, and
     * the Azure views do not need a workspace.
     *
     * @param folder Local folder to open, for the rare test that needs one.
     */
    workbenchUrl(folder?: string): string;
    /** Stops the server process and resolves once it has exited. */
    stop(): Promise<void>;
}

/** Maps the current process platform/arch onto a `server-*-web` download platform. */
function serverPlatform(): string {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    switch (process.platform) {
        case 'win32':
            return `server-win32-${arch}-web`;
        case 'darwin':
            return arch === 'arm64' ? 'server-darwin-arm64-web' : 'server-darwin-web';
        default:
            return `server-linux-${arch}-web`;
    }
}

/**
 * Resolves the command used to launch the server.
 *
 * The archive ships its own Node binary, so prefer invoking `server-main.js`
 * directly -- that avoids the `.cmd`/`.sh` shim, and therefore avoids needing a
 * shell (and shell quoting) on Windows.
 */
function resolveServerCommand(scriptPath: string): ServerCommand {
    // `scriptPath` is `<serverDir>/bin/code-server[.cmd]`.
    const serverDir = path.resolve(path.dirname(scriptPath), '..');
    const nodePath = path.join(serverDir, process.platform === 'win32' ? 'node.exe' : 'node');
    const serverMain = path.join(serverDir, 'out', 'server-main.js');

    if (existsSync(nodePath) && existsSync(serverMain)) {
        return { command: nodePath, prefixArgs: [serverMain] };
    }

    return { command: scriptPath, prefixArgs: [] };
}

/**
 * Downloads (once, into the shared `.vscode-test` cache) and starts the VS Code
 * server with this extension installed and mock Azure data enabled.
 *
 * The extension must already be built (`pnpm run build`); the first call also
 * packages it into a VSIX and installs it into a throwaway extensions directory.
 *
 * @param options.port Port to listen on. `0` (the default) lets the server pick a free one.
 * @param options.onOutput Receives raw server stdout/stderr text, for debugging.
 * @throws If the server exits, or does not report a URL, before the start timeout elapses.
 */
export async function startVSCodeServer(options: { port?: number; onOutput?: (text: string) => void } = {}): Promise<VSCodeServer> {
    const scriptPath = await downloadAndUnzipVSCode({
        platform: serverPlatform(),
        cachePath: testCachePath,
    });

    const serverCommand = resolveServerCommand(scriptPath);
    const { command, prefixArgs } = serverCommand;
    const dataDir = uiTempDir('server-data');
    const extensionsDir = uiTempDir('server-extensions');

    writeServerUserSettings(dataDir);
    await installHarnessExtension(serverCommand, extensionsDir, dataDir, options.onOutput);

    const args = [
        ...prefixArgs,
        '--host', '127.0.0.1',
        '--port', String(options.port ?? 0),
        '--without-connection-token',
        '--accept-server-license-terms',
        '--telemetry-level', 'off',
        '--server-data-dir', dataDir,
        '--extensions-dir', extensionsDir,
    ];

    const child = spawn(command, args, {
        env: { ...process.env, ...mockDataEnv },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    const url = await waitForServerUrl(child, options.onOutput);

    return {
        url,
        workbenchUrl(folder?: string): string {
            const workbench = new URL(url);
            if (folder) {
                // The workbench expects a POSIX-ish path (`/D:/dir`); a raw
                // Windows path is treated as relative and fails to resolve.
                workbench.searchParams.set('folder', `/${folder.replace(/\\/g, '/').replace(/^\//, '')}`);
            }
            return workbench.toString();
        },
        stop: async () => {
            await stopProcess(child);
            removeUiTempDir(dataDir);
            removeUiTempDir(extensionsDir);
        },
    };
}

/** Resolves with the workbench URL the server prints on startup. */
function waitForServerUrl(child: ChildProcess, onOutput?: (text: string) => void): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        let output = '';
        let settled = false;

        const finish = (error: Error | undefined, url?: string) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            if (error) {
                reject(error);
            } else {
                resolve(url ?? '');
            }
        };

        const timer = setTimeout(
            () => { finish(new Error(`Timed out waiting for the VS Code server to start.\n${output}`)); },
            serverStartTimeout,
        );

        const onData = (chunk: Buffer) => {
            const text = chunk.toString();
            output += text;
            onOutput?.(text);

            const match = /Web UI available at (\S+)/.exec(output);
            if (match) {
                finish(undefined, match[1]);
            }
        };

        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);
        child.on('error', error => { finish(error); });
        child.on('exit', code => { finish(new Error(`The VS Code server exited with code ${code} before reporting a URL.\n${output}`)); });
    });
}

/** Kills a child process tree and resolves once it has exited. */
async function stopProcess(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) {
        return;
    }

    const exited = new Promise<void>(resolve => { child.once('exit', () => { resolve(); }); });

    if (process.platform === 'win32' && child.pid !== undefined) {
        // The server spawns extension-host children; `taskkill /T` reaps the tree.
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
        child.kill('SIGTERM');
    }

    await exited;
}
