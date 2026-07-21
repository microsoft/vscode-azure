/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { default as which } from 'which';

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
 * that, this resolves the command against `PATH` via {@linkcode which} and
 * returns the absolute path. Commands that already specify a path (absolute, or
 * relative such as `./cmd` / `../cmd`) are returned unchanged, as are commands
 * that cannot be resolved (the original name is returned so the caller's own
 * error handling can report the failure).
 *
 * On non-Windows platforms the cwd is not part of the implicit search path, so
 * the command is returned unchanged.
 *
 * Successful resolutions are cached by command name for the process lifetime.
 *
 * @param command - The command name or path to resolve.
 * @returns The resolved absolute path, or {@linkcode command} unchanged when it
 *   is already a path, running on a non-Windows platform, or could not be found
 *   on `PATH`.
 */
export function getSafeExecPath(command: string): string {
    // The cwd-hijack risk is Windows-specific; other platforms don't search the cwd implicitly.
    if (process.platform !== 'win32') {
        return command;
    }

    // An explicit path (absolute or relative) is an intentional choice; leave it alone.
    if (/[\\/]/.test(command) || command.startsWith('.')) {
        return command;
    }

    const cached = resolvedPathCache.get(command);
    if (cached !== undefined) {
        return cached;
    }

    const resolved = which.sync(command, { nothrow: true });
    if (resolved) {
        resolvedPathCache.set(command, resolved);
        return resolved;
    }

    // Unresolved commands are not cached so a later PATH/install change can succeed.
    return command;
}
