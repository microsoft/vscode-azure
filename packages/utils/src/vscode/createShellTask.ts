/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProcessError, resolveExecutable } from '@azure/core-process';
import type * as vscode from 'vscode';
import { argToString, ShellQuoting, type CommandLineArg, type CommandLineArgs } from '../base/CommandLineBuilder';
import { mergeProcessEnv } from '../base/mergeProcessEnv';
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
 * A bare command name is resolved against `PATH` to an absolute path, so a
 * same-named binary in the working directory cannot hijack execution -- the
 * shell backing a {@linkcode vscode.ShellExecution ShellExecution} would
 * otherwise consult the working directory first on Windows. A bare name that
 * does not resolve is rejected rather than handed to the shell, since that is
 * exactly the case where a planted binary would be the only candidate.
 *
 * A command carrying a path separator is a deliberate choice by the caller, so
 * it is passed through unchanged and the terminal reports any failure. This is
 * what keeps script targets such as `./deploy.ps1` working: they never resolve,
 * because {@linkcode resolveExecutable} only accepts executable extensions.
 *
 * The resolved path is strongly quoted, since it may contain spaces.
 *
 * @throws {Error} When the command vector does not contain an executable.
 * @throws {ProcessError} With code `ENOENT` when a bare command name is not
 *   found on `PATH`.
 */
export function createShellTask(code: IVsCode, options: CreateShellTaskOptions): vscode.Task {
    const [executable, ...args] = options.command;
    // Flattened before the check so a quoted empty string is rejected here
    // rather than by the resolver.
    const name = options.command.length > 0 ? argToString(executable) : '';
    if (!name) {
        throw new Error('A command line must include at least the executable as its first element.');
    }

    const resolved = resolveExecutable(name, {
        cwd: options.cwd?.fsPath,
        // Resolved against the environment the task will actually run under,
        // since VS Code merges `env` over the parent environment. A caller that
        // overrides `PATH` must not have the executable looked up on a
        // different one.
        env: mergeProcessEnv(options.env),
        // Batch files are allowed so Windows `.cmd` shims (the Azure CLI's
        // `az.cmd`) resolve; a shell runs the task, so it can invoke them.
        allowWindowsBatchFiles: true,
    });

    if (resolved === undefined && isBareName(name)) {
        // Matches the code the background path surfaces for a missing
        // executable, so callers can treat both the same way.
        throw new ProcessError(`The executable '${name}' could not be found on PATH.`, { code: 'ENOENT' });
    }

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

/**
 * Returns `true` when {@linkcode command} carries no directory component, so
 * the shell would have to search for it.
 *
 * @remarks
 * Mirrors the separator handling in {@linkcode resolveExecutable}: a backslash
 * only separates paths on Windows. A drive-qualified path (`C:\tools\x.exe`)
 * always contains a separator, and the drive-relative form (`C:x`) is rejected
 * by the resolver before it can reach here.
 */
function isBareName(command: string): boolean {
    return !command.includes('/') && !(process.platform === 'win32' && command.includes('\\'));
}
