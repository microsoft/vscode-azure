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
 * The executable is resolved to a safe absolute path via
 * {@linkcode getSafeExecPath} so execution cannot be hijacked by a same-named
 * binary in the current working directory on Windows. Under a shell, nano-spawn
 * concatenates the command and arguments into a single unquoted string, so a
 * resolved path containing a space would be mis-split; in that case the resolved
 * path is wrapped in double quotes so the shell treats it as a single token.
 * Quoting rather than falling back to the bare command keeps the cwd-hijack
 * mitigation intact.
 *
 * @throws {Error} When the command vector does not contain an executable.
 */
export async function resolveCommandLine(commandLine: CommandLineArgs, shell: boolean | string = false): Promise<{ command: string; args: CommandLineArgs }> {
    if (commandLine.length === 0) {
        throw new Error('A command line must include at least the executable as its first element.');
    }

    const [executable, ...args] = commandLine;
    const command = await getSafeExecPath(argToString(executable));

    // A shell space-joins the command and arguments without quoting, so a
    // resolved path containing a space would be mis-split. Quote it so the shell
    // treats it as a single token while preserving the cwd-hijack mitigation.
    if (shell && command.includes(' ')) {
        return { command: `"${command}"`, args };
    }

    return { command, args };
}
