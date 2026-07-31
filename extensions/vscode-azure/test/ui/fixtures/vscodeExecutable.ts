/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Resolves the desktop VS Code executable the UI tests drive.
 *
 * Preference order:
 * 1. `VSCODE_AZURE_UI_EXECUTABLE`, for pinning an exact build.
 * 2. The `.vscode-test` download cache (shared with `@vscode/test-cli`).
 * 3. A locally installed VS Code, so the suite still runs where
 *    `update.code.visualstudio.com` is unreachable.
 */

import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { testCachePath } from './paths';

/** Well-known install locations for a stable/Insiders VS Code, most preferred first. */
function localInstallCandidates(): string[] {
    const home = os.homedir();

    switch (process.platform) {
        case 'win32':
            return [
                path.join(process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'Programs', 'Microsoft VS Code', 'Code.exe'),
                path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft VS Code', 'Code.exe'),
                path.join(process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'Programs', 'Microsoft VS Code Insiders', 'Code - Insiders.exe'),
            ];
        case 'darwin':
            return [
                '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
                path.join(home, 'Applications', 'Visual Studio Code.app', 'Contents', 'MacOS', 'Electron'),
                '/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Electron',
            ];
        default:
            return [
                '/usr/share/code/code',
                '/usr/bin/code',
                '/snap/code/current/usr/share/code/code',
            ];
    }
}

/**
 * Returns the path to a VS Code executable suitable for `_electron.launch()`.
 *
 * @throws If no executable could be downloaded or found locally.
 */
export async function resolveVSCodeExecutable(): Promise<string> {
    const pinned = process.env.VSCODE_AZURE_UI_EXECUTABLE;
    if (pinned) {
        if (!existsSync(pinned)) {
            throw new Error(`VSCODE_AZURE_UI_EXECUTABLE points at a missing file: ${pinned}`);
        }
        return pinned;
    }

    try {
        return await downloadAndUnzipVSCode({ cachePath: testCachePath });
    } catch (error) {
        const local = localInstallCandidates().find(candidate => existsSync(candidate));
        if (!local) {
            throw new Error(
                'Could not download VS Code and no local installation was found. ' +
                'Set VSCODE_AZURE_UI_EXECUTABLE to a VS Code executable to run the UI tests offline.',
                { cause: error },
            );
        }

        console.warn(`[ui] VS Code download unavailable; falling back to the local installation at ${local}`);
        return local;
    }
}
