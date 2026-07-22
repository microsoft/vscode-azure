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
 * that, this scans the directories on `PATH` directly (never the cwd) and
 * returns the first matching executable as an absolute path. Commands that
 * already specify a path (absolute, or relative such as `./cmd` / `../cmd`) are
 * returned unchanged, as are commands that cannot be resolved (the original name
 * is returned so the caller's own error handling can report the failure).
 *
 * A bare command name (no known executable extension) is matched against each
 * `PATHEXT` extension in order; a name that already carries a known extension is
 * matched as-is. This deliberately excludes the cwd, unlike `which` (and the
 * Windows shell), which search the cwd first.
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

    const pathEnv = process.env.PATH ?? process.env.Path ?? '';
    const directories = pathEnv.split(path.delimiter).filter((dir) => dir.length > 0);

    const pathExt = (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(path.delimiter).filter((ext) => ext.length > 0);
    const lowerCommand = command.toLowerCase();
    const hasKnownExtension = pathExt.some((ext) => lowerCommand.endsWith(ext.toLowerCase()));
    // A command that already carries a known extension is matched verbatim;
    // otherwise try each PATHEXT extension in order.
    const extensions = hasKnownExtension ? [''] : pathExt;

    // Scan directories (and extensions) in order so the first PATH match wins,
    // matching the shell's precedence while never consulting the cwd.
    for (const directory of directories) {
        // Windows PATH entries are sometimes wrapped in double quotes; strip them.
        const cleanDirectory = directory.replace(/^"(.*)"$/, '$1');
        for (const extension of extensions) {
            const candidate = path.win32.join(cleanDirectory, command + extension);
            if (await isExecutableFile(candidate)) {
                resolvedPathCache.set(command, candidate);
                return candidate;
            }
        }
    }

    // Unresolved commands are not cached so a later PATH/install change can succeed.
    return command;
}

/** Returns `true` when {@linkcode candidate} exists and is a regular file. */
async function isExecutableFile(candidate: string): Promise<boolean> {
    try {
        const stats = await fs.stat(candidate);
        return stats.isFile();
    } catch {
        return false;
    }
}
