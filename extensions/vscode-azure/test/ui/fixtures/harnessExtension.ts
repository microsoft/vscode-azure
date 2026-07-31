/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Packages and installs the extension into a VS Code **server** so the web
 * workbench can load it.
 *
 * The desktop Electron runs use `--extensionDevelopmentPath`, but released
 * server builds reject that flag (`Ignoring option 'extensionDevelopmentPath':
 * not supported for server.`). Only VS Code's own from-source server honours it.
 * So the harness packages a VSIX and installs it with the server CLI instead.
 *
 * Because an installed extension activates in `ExtensionMode.Production`, and
 * `.vscodeignore` keeps `dist/test/**` out of every package, the mock-data
 * bundle is copied into the installed extension afterwards -- that file's
 * presence is exactly what lets `main.js` apply the mock overrides (see
 * `resolveOverrideBundlePath` there).
 */

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { extensionRoot } from './paths';

/**
 * Where the harness VSIX is cached between runs.
 *
 * Deliberately *not* under `.vscode-test`: that directory is often a junction to
 * a cache shared across worktrees, and each worktree needs its own build.
 */
const harnessCacheDir = path.join(extensionRoot, 'test-results', 'harness');
const harnessVsixPath = path.join(harnessCacheDir, 'vscode-azure-ui-harness.vsix');

/** Build outputs the harness depends on. */
const extensionBundlePath = path.join(extensionRoot, 'dist', 'extension.bundle.js');
const mockBundleRelativePath = path.join('dist', 'test', 'mock.bundle.js');

/** How the server build is invoked (see `resolveServerCommand` in `vscodeServer.ts`). */
export interface ServerCommand {
    readonly command: string;
    readonly prefixArgs: readonly string[];
}

/**
 * Packages the built extension into a VSIX under the `.vscode-test` cache.
 *
 * The VSIX is reused while it is newer than `dist/extension.bundle.js`, so only
 * the first run after a build pays the packaging cost.
 *
 * @throws If the extension has not been built, or if `vsce` fails.
 */
export async function packageHarnessVsix(): Promise<string> {
    if (!existsSync(extensionBundlePath)) {
        throw new Error(`The extension is not built: ${extensionBundlePath} is missing. Run "pnpm --filter vscode-azure run build" first.`);
    }

    if (existsSync(harnessVsixPath) && statSync(harnessVsixPath).mtimeMs >= statSync(extensionBundlePath).mtimeMs) {
        return harnessVsixPath;
    }

    mkdirSync(harnessCacheDir, { recursive: true });

    // Run vsce's JS entry point with the current Node so no shell (and no shell
    // quoting) is involved on Windows.
    const vsceScript = path.join(path.dirname(require.resolve('@vscode/vsce/package.json')), 'vsce');
    await run(process.execPath, [vsceScript, 'package', '--no-dependencies', '--out', harnessVsixPath], extensionRoot);

    return harnessVsixPath;
}

/**
 * Installs the harness VSIX into `extensionsDir` and restores the mock-data bundle.
 *
 * @param server How to invoke the server build's CLI.
 * @param onOutput Receives CLI output, for debugging.
 */
export async function installHarnessExtension(
    server: ServerCommand,
    extensionsDir: string,
    serverDataDir: string,
    onOutput?: (text: string) => void,
): Promise<void> {
    const vsix = await packageHarnessVsix();

    await run(
        server.command,
        [
            ...server.prefixArgs,
            '--install-extension', vsix,
            '--force',
            '--extensions-dir', extensionsDir,
            '--server-data-dir', serverDataDir,
            '--accept-server-license-terms',
            '--telemetry-level', 'off',
        ],
        extensionRoot,
        onOutput,
    );

    copyMockBundle(extensionsDir);
}

/**
 * Seeds server-side user settings so the workbench comes up in a predictable
 * state: no workspace-trust modal, no welcome editor, no update checks.
 *
 * Both known layouts are written because the location moved between server
 * versions and an unused file is harmless.
 */
export function writeServerUserSettings(serverDataDir: string): void {
    const settings = {
        'security.workspace.trust.enabled': false,
        'workbench.startupEditor': 'none',
        'telemetry.telemetryLevel': 'off',
        'update.mode': 'none',
        'extensions.autoCheckUpdates': false,
        'window.commandCenter': false,
    };

    for (const dir of [path.join(serverDataDir, 'data', 'User'), path.join(serverDataDir, 'User')]) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings, undefined, 4), 'utf8');
    }
}

/** Copies `dist/test/mock.bundle.js` into the installed copy of the extension. */
function copyMockBundle(extensionsDir: string): void {
    const source = path.join(extensionRoot, mockBundleRelativePath);
    if (!existsSync(source)) {
        throw new Error(`The mock-data bundle is missing: ${source}. Run "pnpm --filter vscode-azure run build" first.`);
    }

    const installed = readdirSync(extensionsDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && entry.name.toLowerCase().startsWith('ms-azuretools.vscode-azure-'))
        .map(entry => path.join(extensionsDir, entry.name));

    if (installed.length === 0) {
        throw new Error(`The extension does not appear to have been installed into ${extensionsDir}.`);
    }

    for (const target of installed) {
        const destination = path.join(target, mockBundleRelativePath);
        mkdirSync(path.dirname(destination), { recursive: true });
        copyFileSync(source, destination);
    }
}

/** Runs a command to completion, rejecting with its output if it fails. */
function run(command: string, args: readonly string[], cwd: string, onOutput?: (text: string) => void): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const child = spawn(command, [...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

        let output = '';
        const collect = (chunk: Buffer) => {
            const text = chunk.toString();
            output += text;
            onOutput?.(text);
        };

        child.stdout.on('data', collect);
        child.stderr.on('data', collect);
        child.on('error', reject);
        child.on('exit', code => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`"${path.basename(command)} ${args[0] ?? ''}" exited with code ${code}.\n${output}`));
            }
        });
    });
}
