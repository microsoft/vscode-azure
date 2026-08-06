/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { argToString, type CommandLineArgs } from './CommandLineBuilder';
import { getSafeExecPath } from './getSafeExecPath';

/**
 * Splits a structured command line into a safely resolved executable and its
 * trailing arguments.
 *
 * The executable is resolved to a safe absolute path so a same-named binary in
 * the working directory cannot hijack execution on Windows. When a shell is
 * used, a resolved path containing spaces is quoted as one token.
 *
 * @throws {Error} When the command vector does not contain an executable.
 */
export async function resolveCommandLine(commandLine: CommandLineArgs, shell: boolean | string = false): Promise<{ command: string; args: CommandLineArgs }> {
    if (commandLine.length === 0) {
        throw new Error('A command line must include at least the executable as its first element.');
    }

    const [executable, ...args] = commandLine;
    const command = await getSafeExecPath(argToString(executable));
    return { command: shell && command.includes(' ') ? `"${command}"` : command, args };
}
