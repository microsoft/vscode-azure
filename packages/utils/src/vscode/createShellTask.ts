/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { resolveExecutable } from '@azure/core-process';
import type * as vscode from 'vscode';
import { argToString, ShellQuoting, type CommandLineArg, type CommandLineArgs } from '../base/CommandLineBuilder';
import type { IVsCode } from './IVsCode';

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
 * @remarks
 * The executable is resolved against `PATH` to an absolute path so a same-named
 * binary in the working directory cannot hijack execution, which the shell
 * backing a {@linkcode vscode.ShellExecution ShellExecution} would otherwise
 * allow on Windows. A command that cannot be resolved is passed through
 * unchanged so the terminal reports the failure itself. The resolved path is
 * strongly quoted, since it may contain spaces.
 *
 * @throws {Error} When the command vector does not contain an executable.
 */
export function createShellTask(code: IVsCode, options: CreateShellTaskOptions): vscode.Task {
    const [executable, ...args] = options.command;
    if (!executable) {
        throw new Error('A command line must include at least the executable as its first element.');
    }

    const name = argToString(executable);
    const resolved = resolveExecutable(name, {
        cwd: options.cwd?.fsPath,
        // Batch files are allowed so Windows `.cmd` shims (the Azure CLI's
        // `az.cmd`) resolve; a shell runs the task, so it can invoke them.
        allowWindowsBatchFiles: true,
    });

    const command: CommandLineArg = resolved === undefined
        ? name
        : { value: resolved, quoting: ShellQuoting.Strong };

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
