/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import type { IVsCode } from '../vscode/IVsCode';
import { argToString, type CommandLineArgs } from './CommandLineBuilder';
import { getSafeExecPath } from './getSafeExecPath';

/**
 * Options for constructing a VS Code shell task from a structured command line.
 */
export interface CreateShellTaskOptions {
    /** The executable followed by its arguments. */
    readonly command: CommandLineArgs;
    readonly name: string;
    readonly definition?: vscode.TaskDefinition;
    readonly scope?: vscode.TaskScope | vscode.WorkspaceFolder;
    readonly source?: string;
    readonly problemMatchers?: string | string[];
    readonly cwd?: vscode.Uri;
    readonly env?: Readonly<Record<string, string>>;
    readonly isBackground?: boolean;
    readonly presentationOptions?: vscode.TaskPresentationOptions;
    /** Adds a random definition value so VS Code always creates a new task instance. */
    readonly alwaysRunNew?: boolean;
}

/**
 * Constructs a shell task while preserving the command's argument-vector and
 * shell-quoting metadata.
 *
 * @throws {Error} When the command vector does not contain an executable.
 */
export async function createShellTask(code: IVsCode, options: CreateShellTaskOptions): Promise<vscode.Task> {
    const { command, args } = await resolveCommandLine(options.command);
    const execution = new code.ShellExecution(
        command,
        args,
        { cwd: options.cwd?.fsPath, env: { ...options.env } },
    );
    const task = new code.Task(
        options.definition ?? { type: 'shell' },
        options.scope ?? code.TaskScope.Workspace,
        options.name,
        options.source ?? 'process',
        execution,
        options.problemMatchers,
    );

    task.isBackground = options.isBackground ?? false;
    if (options.presentationOptions) {
        task.presentationOptions = options.presentationOptions;
    }
    if (options.alwaysRunNew) {
        task.definition.idRandomizer = Math.random();
    }

    return task;
}

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
