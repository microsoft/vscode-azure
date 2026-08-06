/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import type { CommandLineArgs } from '../base/CommandLineBuilder';
import { resolveCommandLine } from '../base/resolveCommandLine';
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
