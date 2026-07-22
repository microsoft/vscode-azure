/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Caches resolved paths by bare command name to avoid repeated `PATH` scans.
 * `PATH` is effectively stable for the lifetime of the extension host, so a
 * process-lifetime cache is safe.
 */
const resolvedPathCache = new Map<string, string>();

/**
 * Resolves a command to a safe, absolute execution path (Windows only).
 *
 * @remarks
 * On Windows, a shell searches the current working directory before `PATH`, so
 * a same-named binary dropped into the cwd can hijack execution. To prevent
 * that, this resolves the command against `PATH` via {@linkcode findOnPath}
 * (which never consults the cwd) and returns the absolute path. Commands that
 * already specify a path (absolute, or relative such as `./cmd` / `../cmd`) are
 * returned unchanged, as are commands that cannot be resolved (the original name
 * is returned so the caller's own error handling can report the failure).
 *
 * On non-Windows platforms the cwd is not part of the implicit search path, so
 * the command is returned unchanged.
 *
 * Successful resolutions are cached by command name for the process lifetime.
 *
 * @param command - The command name or path to resolve.
 * @returns A promise for the resolved absolute path, or {@linkcode command}
 *   unchanged when it is already a path, running on a non-Windows platform, or
 *   could not be found on `PATH`.
 */
export async function getSafeExecPath(command: string): Promise<string> {
    // The cwd-hijack risk is Windows-specific; other platforms don't search the cwd implicitly.
    if (process.platform !== 'win32') {
        return command;
    }

    // An explicit path (absolute or relative) is an intentional choice; leave it alone.
    // A bare command name has no directory component, so it equals its own basename;
    // anything with a separator, drive, or UNC prefix differs (using Windows semantics).
    if (command !== path.win32.basename(command)) {
        return command;
    }

    const cached = resolvedPathCache.get(command);
    if (cached !== undefined) {
        return cached;
    }

    const resolved = await findOnPath(command);
    if (resolved !== undefined) {
        resolvedPathCache.set(command, resolved);
        return resolved;
    }

    // Unresolved commands are not cached so a later PATH/install change can succeed.
    return command;
}

/**
 * Finds a bare command on `PATH` and returns its absolute path, if any.
 *
 * @remarks
 * Scans the directories on `PATH` in order and returns the first match. Unlike
 * `which` (and the Windows shell), this deliberately never consults the current
 * working directory, so a same-named binary in the cwd cannot hijack the result.
 *
 * On Windows, `PATHEXT` extensions are appended in order (a command that already
 * carries a known extension is matched verbatim) and any file match is treated
 * as executable. On other platforms the command is matched as-is and must also
 * carry an executable permission bit.
 *
 * @param command - A bare command name (no path separator). Callers with an
 *   explicit path should check that path directly rather than calling this.
 * @returns A promise for the absolute path of the first match, or `undefined`
 *   when the command is not found on `PATH`.
 */
export async function findOnPath(command: string): Promise<string | undefined> {
    const isWindows = process.platform === 'win32';
    const nodePath = isWindows ? path.win32 : path.posix;

    const pathEnv = process.env.PATH ?? (isWindows ? process.env.Path : undefined) ?? '';
    const directories = pathEnv.split(path.delimiter).filter(Boolean);

    const extensions = isWindows ? windowsExtensions(command) : [''];

    // Scan directories (and extensions) in order so the first PATH match wins,
    // matching the shell's precedence while never consulting the cwd.
    for (const directory of directories) {
        // Windows PATH entries are sometimes wrapped in double quotes; strip them.
        const cleanDirectory = isWindows ? directory.replace(/^"(.*)"$/, '$1') : directory;
        for (const extension of extensions) {
            const candidate = nodePath.join(cleanDirectory, command + extension);
            if (await isExecutableFile(candidate)) {
                return candidate;
            }
        }
    }

    return undefined;
}

/**
 * Returns the `PATHEXT` extensions to try for {@linkcode command} on Windows. A
 * command that already carries a known extension is matched verbatim (`['']`);
 * otherwise each `PATHEXT` entry is tried in order.
 */
function windowsExtensions(command: string): readonly string[] {
    const pathExt = (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(path.delimiter).filter(Boolean);
    const lowerCommand = command.toLowerCase();
    const hasKnownExtension = pathExt.some((ext) => lowerCommand.endsWith(ext.toLowerCase()));
    return hasKnownExtension ? [''] : pathExt;
}

/**
 * Returns `true` when {@linkcode candidate} is a regular file that can be
 * executed. On Windows an executable extension (`PATHEXT`) already implies
 * executability, so only the file check applies; elsewhere an executable
 * permission bit is also required.
 */
async function isExecutableFile(candidate: string): Promise<boolean> {
    try {
        const stats = await fs.stat(candidate);
        if (!stats.isFile()) {
            return false;
        }
        if (process.platform !== 'win32') {
            await fs.access(candidate, fs.constants.X_OK);
        }
        return true;
    } catch {
        return false;
    }
}
