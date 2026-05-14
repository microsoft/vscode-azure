/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AccumulatorStream, ChildProcessError, getSafeExecPath,
    isChildProcessError,
    isCancellationError as isProcessUtilsCancellationError,
    spawnStreamAsync,
    type CancellationTokenLike, type CommandLineArgs
} from '@microsoft/vscode-processutils';
import type { ServiceIdentifier } from 'inversify';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import type * as vscode from 'vscode';
import { CancellationError } from '../vscode/CancellationError';
import type { Disposable } from '../vscode/Disposable';
import type { IVsCode } from '../vscode/IVsCode';

export {
    ChildProcessError, isChildProcessError,
    type CancellationTokenLike, type CommandLineArgs
} from '@microsoft/vscode-processutils';

/**
 * Signature matching {@linkcode spawnStreamAsync}. Exposed so tests can
 * inject a mock without replacing the module.
 */
export type SpawnFn = typeof spawnStreamAsync;

/**
 * Shared options for all process execution modes.
 */
export interface ProcessExecutorOptions {
    readonly command: string;
    readonly args?: CommandLineArgs;
    readonly cwd?: vscode.Uri;
    readonly env?: Readonly<Record<string, string>>;
}

/**
 * Runs a process in the background, returning raw stdout and stderr.
 */
export interface BackgroundProcessOptions extends ProcessExecutorOptions {
    readonly execution: 'background';
    readonly parseJson?: false;
    readonly jsonLines?: false;
}

/**
 * Runs a process in the background and parses stdout as JSON.
 */
export interface BackgroundJsonProcessOptions extends ProcessExecutorOptions {
    readonly execution: 'background';
    readonly parseJson: true;
}

/**
 * Runs a process in the background, parses stdout as JSON, and streams
 * stderr as newline-delimited JSON via an async generator.
 */
export interface BackgroundJsonLinesProcessOptions extends ProcessExecutorOptions {
    readonly execution: 'background';
    readonly parseJson: true;
    readonly jsonLines: true;
}

/**
 * Runs a process as a VS Code task, visible in the integrated terminal.
 * Returns `Promise<void>` because task output is not capturable.
 */
export interface ForegroundProcessOptions extends ProcessExecutorOptions {
    readonly execution: 'foreground';
    /** Display name passed to the {@linkcode vscode.Task Task} constructor. Shown in the task list and terminal tab. */
    readonly name: string;
    /** Scopes the task to a specific workspace folder. Defaults to {@linkcode vscode.TaskScope.Workspace TaskScope.Workspace}. */
    readonly workspaceFolder?: vscode.WorkspaceFolder;
    /** The source label shown in the task list. Defaults to `'process'`. */
    readonly source?: string;
    /** When `true`, adds a random value to the task definition so a new instance is always created. */
    readonly alwaysRunNew?: boolean;
    /** When `true`, focuses the task's terminal panel when the task starts. */
    readonly focus?: boolean;
}

/**
 * Captured output from a background process.
 */
export interface ProcessResult {
    readonly stdout: string;
    readonly stderr: string;
}

/**
 * Captured output from a background process with stdout parsed as JSON.
 */
export interface JsonProcessResult<T> extends ProcessResult {
    readonly json: T;
}

/**
 * The caller is responsible for awaiting {@linkcode completed} or attaching
 * a `.catch()` handler. If the process fails and `completed` is never
 * awaited, the rejection will be unhandled.
 */
export interface JsonLinesProcessResult<TOut = unknown, TLines = unknown> {
    readonly jsonLines: AsyncGenerator<TLines>;
    readonly completed: Promise<JsonProcessResult<TOut>>;
}

export const IProcessExecutor: ServiceIdentifier<IProcessExecutor> = Symbol.for('IProcessExecutor');

/**
 * Executes external processes in the background or as VS Code tasks.
 *
 * @remarks
 * The `execution` discriminant on the options object determines the execution
 * mode:
 *
 * - `'background'` -- runs via {@linkcode spawnStreamAsync} and captures
 *   stdout/stderr. Supports optional JSON parsing and JSON-lines streaming.
 * - `'foreground'` -- runs as a {@linkcode vscode.Task Task} visible in the
 *   integrated terminal. Returns `Promise<void>` since task output is not
 *   capturable.
 *
 * On failure, background execution throws {@linkcode ChildProcessError}
 * enriched with captured stderr. Cancellation (via {@linkcode CancellationTokenLike})
 * throws {@linkcode CancellationError} in both modes.
 */
export interface IProcessExecutor {
    /** Runs a process as a VS Code task. Resolves when the task exits with code 0. */
    spawn(options: ForegroundProcessOptions, cancellationToken?: CancellationTokenLike): Promise<void>;
    /** Runs a background process, parses stdout as JSON, and streams stderr as newline-delimited JSON objects. */
    spawn<TOut = unknown, TLines = unknown>(options: BackgroundJsonLinesProcessOptions, cancellationToken?: CancellationTokenLike): Promise<JsonLinesProcessResult<TOut, TLines>>;
    /** Runs a background process and parses stdout as JSON. */
    spawn<T = unknown>(options: BackgroundJsonProcessOptions, cancellationToken?: CancellationTokenLike): Promise<JsonProcessResult<T>>;
    /** Runs a background process and captures raw stdout and stderr. */
    spawn(options: BackgroundProcessOptions, cancellationToken?: CancellationTokenLike): Promise<ProcessResult>;
}

/**
 * Default implementation of {@linkcode IProcessExecutor}.
 *
 * @param code - The VS Code API surface for task execution.
 * @param spawnFn - Optional override for {@linkcode spawnStreamAsync}, primarily
 *   for injecting a mock in unit tests. Defaults to the real implementation.
 */
export class ProcessExecutor implements IProcessExecutor {
    public constructor(
        private readonly code: IVsCode,
        private readonly spawnFn: SpawnFn = spawnStreamAsync,
    ) { }

    public async spawn(options: ForegroundProcessOptions, cancellationToken?: CancellationTokenLike): Promise<void>;
    public async spawn<TOut = unknown, TLines = unknown>(options: BackgroundJsonLinesProcessOptions, cancellationToken?: CancellationTokenLike): Promise<JsonLinesProcessResult<TOut, TLines>>;
    public async spawn<T = unknown>(options: BackgroundJsonProcessOptions, cancellationToken?: CancellationTokenLike): Promise<JsonProcessResult<T>>;
    public async spawn(options: BackgroundProcessOptions, cancellationToken?: CancellationTokenLike): Promise<ProcessResult>;
    public async spawn(
        options: ForegroundProcessOptions | BackgroundJsonLinesProcessOptions | BackgroundJsonProcessOptions | BackgroundProcessOptions,
        cancellationToken?: CancellationTokenLike,
    ): Promise<void | ProcessResult | JsonProcessResult<unknown> | JsonLinesProcessResult> {
        if (options.execution === 'foreground') {
            return this.spawnForeground(options, cancellationToken);
        } else {
            return this.spawnBackground(options, cancellationToken);
        }
    }

    private async spawnForeground(options: ForegroundProcessOptions, cancellationToken?: CancellationTokenLike): Promise<void> {
        const shellExecution = new this.code.ShellExecution(
            getSafeExecPath(options.command),
            options.args ?? [],
            { cwd: options.cwd?.fsPath, env: { ...options.env } },
        );

        const task = new this.code.Task(
            { type: 'shell' },
            options.workspaceFolder ?? this.code.TaskScope.Workspace,
            options.name,
            options.source ?? 'process',
            shellExecution,
        );

        if (options.alwaysRunNew) {
            task.definition.idRandomizer = Math.random();
        }

        if (options.focus) {
            task.presentationOptions = { focus: true };
        }

        const taskExecution = await this.code.tasks.executeTask(task);

        return new Promise<void>((resolve, reject) => {
            let ctDisposable: Disposable | undefined;

            if (cancellationToken) {
                ctDisposable = cancellationToken.onCancellationRequested(() => {
                    taskExecution.terminate();
                    ctDisposable?.dispose();
                    endDisposable.dispose();
                    reject(new CancellationError());
                });
            }

            const endDisposable = this.code.tasks.onDidEndTaskProcess((e) => {
                if (e.execution === taskExecution) {
                    ctDisposable?.dispose();
                    endDisposable.dispose();
                    if (e.exitCode === 0) {
                        resolve();
                    } else {
                        reject(new ChildProcessError(
                            this.code.l10n.t(
                                "'{0}' failed with exit code {1}. See the '{0}' terminal for the full output.",
                                options.name,
                                e.exitCode ?? -1,
                            ),
                            e.exitCode ?? -1,
                            null,
                        ));
                    }
                }
            });
        });
    }

    private async spawnBackground(
        options: BackgroundProcessOptions | BackgroundJsonProcessOptions | BackgroundJsonLinesProcessOptions,
        cancellationToken?: CancellationTokenLike,
    ): Promise<ProcessResult | JsonProcessResult<unknown> | JsonLinesProcessResult> {
        const stdErrPassThrough = 'jsonLines' in options && options.jsonLines
            ? new PassThrough()
            : undefined;
        const stdErrAccumulator = new AccumulatorStream();

        stdErrPassThrough?.pipe(stdErrAccumulator);

        const stdOutStream = new AccumulatorStream();
        const stdErrStream = stdErrPassThrough ?? stdErrAccumulator;

        const spawnPromise = this.spawnFn(options.command, options.args ?? [], {
            cwd: options.cwd?.fsPath,
            env: options.env ? { ...process.env, ...options.env } : undefined,
            cancellationToken,
            stdOutPipe: stdOutStream,
            stdErrPipe: stdErrStream,
        });

        if (stdErrPassThrough) {
            const completed = spawnPromise.then(async () => {
                const stdout = await stdOutStream.getString();
                const stderr = await stdErrAccumulator.getString();
                const json: unknown = JSON.parse(stdout);
                return { stdout, stderr, json };
            }, async (e: unknown) => {
                const stderr = await stdErrAccumulator.getString();
                throw enrichError(e, stderr);
            });

            return {
                jsonLines: parseJsonLines(stdErrPassThrough),
                completed,
            };
        }

        try {
            await spawnPromise;
        } catch (e) {
            const stderr = await stdErrAccumulator.getString();
            throw enrichError(e, stderr);
        }

        const stdout = await stdOutStream.getString();
        const stderr = await stdErrAccumulator.getString();

        if (options.parseJson) {
            const json: unknown = JSON.parse(stdout);
            return { stdout, stderr, json };
        }

        return { stdout, stderr };
    }
}

function enrichError(e: unknown, stderr: string): unknown {
    if (isProcessUtilsCancellationError(e)) {
        return new CancellationError();
    } else if (isChildProcessError(e)) {
        const msg = stderr.trim() || e.message;
        const enriched = new ChildProcessError(msg, e.code, e.signal);
        enriched.cause = e;
        return enriched;
    }
    return e;
}

async function* parseJsonLines(input: NodeJS.ReadableStream): AsyncGenerator {
    const rl = createInterface({ input });
    try {
        for await (const line of rl) {
            const trimmed = line.trim();
            if (trimmed.length > 0) {
                try {
                    yield JSON.parse(trimmed);
                } catch {
                    // Not valid JSON -- skip the line
                }
            }
        }
    } finally {
        rl.close();
    }
}
