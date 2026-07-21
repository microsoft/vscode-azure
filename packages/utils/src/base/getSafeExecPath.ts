/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { default as which } from 'which';

/**
 * Resolves a command to a safe, absolute execution path.
 *
 * @remarks
 * Searches the `PATH` environment variable via {@linkcode which} so the current
 * working directory is never searched implicitly -- this avoids accidentally
 * executing a same-named binary dropped into the cwd. Commands that already
 * specify a path (absolute, or relative such as `./cmd` / `../cmd`) are returned
 * unchanged, as are commands that cannot be resolved (the original name is
 * returned so the caller's own error handling can report the failure).
 *
 * @param command - The command name or path to resolve.
 * @returns The resolved absolute path, or {@linkcode command} unchanged when it
 *   is already a path or could not be found on `PATH`.
 */
export function getSafeExecPath(command: string): string {
    // An explicit path (absolute or relative) is an intentional choice; leave it alone.
    if (/[\\/]/.test(command) || command.startsWith('.')) {
        return command;
    }

    const resolved = which.sync(command, { nothrow: true });
    return resolved ?? command;
}
