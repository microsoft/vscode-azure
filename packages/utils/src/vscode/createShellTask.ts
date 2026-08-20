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
 * it is passed through unchanged and the terminal reports any failure. It is
 * never rewritten to an absolute path: the task's working directory is the
 * shell's, not this process's, so a path resolved here could name a different
 * file than the one the caller meant. This is also what keeps script targets
 * such as `./deploy.ps1` working: they never resolve, because
 * {@linkcode resolveExecutable} only accepts executable extensions.
 *
 * The resolved path is strongly quoted, since it may contain spaces.
 *
 * @throws {Error} When the command vector does not contain an executable.
 * @throws {ProcessError} With code `ENOENT` when a bare command name is not
 *   found on `PATH`, or `ERR_INVALID_EXECUTABLE` when the name contains a NUL
 *   or newline.
 */
export function createShellTask(code: IVsCode, options: CreateShellTaskOptions): vscode.Task {
    const [executable, ...args] = options.command;
    // Flattened before the check so a quoted empty string is rejected here
    // rather than by the resolver.
    const name = options.command.length > 0 ? argToString(executable) : '';
    if (!name) {
        throw new Error('A command line must include at least the executable as its first element.');
    }

    // Resolution serves two purposes. It validates the name -- a NUL or newline
    // is rejected here rather than reaching a shell that would read the newline
    // as a command separator -- and it yields the absolute path a bare name
    // must be pinned to.
    //
    // `cwd` is deliberately not passed: a bare name never resolves against it,
    // and an explicit path keeps the caller's own spelling (see below), so the
    // resolver never needs it.
    const resolved = resolveExecutable(name, {
        // Resolved against the environment the task will actually run under,
        // since VS Code merges `env` over the parent environment. A caller that
        // overrides `PATH` must not have the executable looked up on a
        // different one.
        env: mergeProcessEnv(options.env),
        // Batch files are allowed so Windows `.cmd` shims (the Azure CLI's
        // `az.cmd`) resolve; a shell runs the task, so it can invoke them.
        allowWindowsBatchFiles: true,
    });

    const bare = isBareName(name);
    if (bare && resolved === undefined) {
        // Matches the code the background path surfaces for a missing
        // executable, so callers can treat both the same way.
        throw new ProcessError(`The executable '${name}' could not be found on PATH.`, { code: 'ENOENT' });
    }

    // Only a bare name adopts the resolved path. An explicit path is resolved
    // against the resolver's working directory, which is not the one the task
    // will run in, so substituting it could launch a different program.
    const command = toExecutableArg(executable, bare ? resolved : undefined);

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

/**
 * Builds the executable element of the {@linkcode vscode.ShellExecution ShellExecution}
 * command line.
 *
 * @remarks
 * A resolved path is emitted with {@linkcode vscode.ShellQuoting.Strong Strong}
 * quoting, so the shell runs exactly the file the resolver picked rather than
 * repeating the search itself.
 *
 * When {@linkcode resolved} is `undefined` -- either resolution failed, or the
 * command is an explicit path that keeps the caller's spelling -- the caller's
 * own {@linkcode CommandLineArg} is passed through untouched, preserving any
 * quoting they asked for. Only an unquoted string is adjusted, and only when it
 * contains a space: without quoting the shell would split it and run the wrong
 * program.
 */
function toExecutableArg(executable: CommandLineArg, resolved: string | undefined): CommandLineArg {
    if (resolved !== undefined) {
        return { value: resolved, quoting: ShellQuoting.Strong };
    }

    if (typeof executable === 'string' && executable.includes(' ')) {
        return { value: executable, quoting: ShellQuoting.Strong };
    }

    return executable;
}
