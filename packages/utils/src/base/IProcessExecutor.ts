/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isProcessError, ProcessError, resolveExecutable, spawn, type SpawnOptions } from '@azure/core-process';
import type { ServiceIdentifier } from 'inversify';
import type { ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';
import type * as vscode from 'vscode';
import { CancellationError } from '../vscode/CancellationError';
import { createShellTask } from '../vscode/createShellTask';
import type { IVsCode } from '../vscode/IVsCode';
import { argsToStrings, type CommandLineArgs } from './CommandLineBuilder';
import { mergeProcessEnv } from './mergeProcessEnv';
import { toAbortSignal } from './toAbortSignal';

export * from './CommandLineBuilder';
export { isProcessError, ProcessError } from '@azure/core-process';

/**
 * Signature matching {@linkcode spawn} from `@azure/core-process`. Exposed so
 * tests can inject a mock subprocess factory without replacing the module.
 */
export type SpawnFn = (command: string, args?: readonly string[], options?: SpawnOptions) => ChildProcess;

/**
 * Shared options for all process execution modes.
 */
export interface ProcessExecutorOptions {
    /**
     * The full command line to run as an argument vector: the executable
     * followed by its arguments. The first element is the executable.
     *
     * @remarks
     * Build one fluently with {@linkcode command} (a {@linkcode CommandLineBuilder}
     * is itself a valid value here) or pass a plain {@linkcode CommandLineArgs}
     * array such as `['winget', 'install', 'microsoft.azd']`.
     */
    readonly command: CommandLineArgs;
    readonly cwd?: vscode.Uri;
    /**
     * Environment variables layered on top of the extension host's own
     * environment. The child always inherits `process.env`; these override
     * individual entries.
     */
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
 * A streaming JSON-lines result: {@linkcode jsonLines} yields each stderr line
 * parsed as JSON as the process emits it, and {@linkcode completed} resolves with
 * the buffered stdout parsed as JSON once the process exits.
 *
 * @remarks
 * stderr is streamed live, so it is not buffered: {@linkcode JsonProcessResult}'s
 * `stderr` on {@linkcode completed} is always an empty string in this mode.
 *
 * The caller **must** drain {@linkcode jsonLines} (e.g. via `for await`) --
 * because stderr buffering is disabled, an undrained stream can backpressure and
 * stall a chatty child process.
 *
 * The caller is also responsible for awaiting {@linkcode completed} or attaching
 * a `.catch()` handler. If the process fails and `completed` is never awaited,
 * the rejection will be unhandled.
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
 * - `'background'` -- runs via `@azure/core-process` and captures
 *   stdout/stderr. Supports optional JSON parsing and JSON-lines streaming.
 * - `'foreground'` -- runs as a {@linkcode vscode.Task Task} visible in the
 *   integrated terminal. Returns `Promise<void>` since task output is not
 *   capturable.
 *
 * Background execution never involves a shell: the executable is resolved
 * against `PATH` and launched with its argument vector intact, so arguments
 * containing spaces, quotes, or shell metacharacters reach the child verbatim.
 * On Windows a `.cmd`/`.bat` shim (such as the Azure CLI's `az.cmd`) is invoked
 * through a pinned `cmd.exe` with each argument escaped individually; an
 * argument that cannot be transported safely is rejected before the process
 * starts rather than silently corrupted.
 *
 * On failure, background execution throws {@linkcode ProcessError}: `code` is
 * the exit code for a process that ran, or an error code such as `'ENOENT'`
 * when the executable could not be found. Foreground failure throws a plain
 * {@linkcode Error}. Cancellation -- via a
 * {@linkcode vscode.CancellationToken CancellationToken} or an
 * {@linkcode AbortSignal} -- throws {@linkcode CancellationError} in both modes.
 */
export interface IProcessExecutor {
    /** Runs a process as a VS Code task. Resolves when the task exits with code 0. */
    spawn(options: ForegroundProcessOptions, cancellation?: vscode.CancellationToken | AbortSignal): Promise<void>;
    /** Runs a background process, parses stdout as JSON, and streams stderr as newline-delimited JSON objects. */
    spawn<TOut = unknown, TLines = unknown>(options: BackgroundJsonLinesProcessOptions, cancellation?: vscode.CancellationToken | AbortSignal): Promise<JsonLinesProcessResult<TOut, TLines>>;
    /** Runs a background process and parses stdout as JSON. */
    spawn<T = unknown>(options: BackgroundJsonProcessOptions, cancellation?: vscode.CancellationToken | AbortSignal): Promise<JsonProcessResult<T>>;
    /** Runs a background process and captures raw stdout and stderr. */
    spawn(options: BackgroundProcessOptions, cancellation?: vscode.CancellationToken | AbortSignal): Promise<ProcessResult>;

    /**
     * Tests whether a command is available on the system `PATH`.
     *
     * @returns `true` when the command can be resolved, `false` otherwise.
     */
    isOnPath(command: string): Promise<boolean>;
}

/**
 * Default implementation of {@linkcode IProcessExecutor}.
 *
 * @param code - The VS Code API surface for task execution.
 * @param spawnFn - Optional override for `@azure/core-process`'s
 *   {@linkcode spawn}, primarily for injecting a mock in unit tests. Defaults to
 *   the real implementation.
 */
export class ProcessExecutor implements IProcessExecutor {
    public constructor(
        private readonly code: IVsCode,
        private readonly spawnFn: SpawnFn = spawn,
    ) { }

    public async spawn(options: ForegroundProcessOptions, cancellation?: vscode.CancellationToken | AbortSignal): Promise<void>;
    public async spawn<TOut = unknown, TLines = unknown>(options: BackgroundJsonLinesProcessOptions, cancellation?: vscode.CancellationToken | AbortSignal): Promise<JsonLinesProcessResult<TOut, TLines>>;
    public async spawn<T = unknown>(options: BackgroundJsonProcessOptions, cancellation?: vscode.CancellationToken | AbortSignal): Promise<JsonProcessResult<T>>;
    public async spawn(options: BackgroundProcessOptions, cancellation?: vscode.CancellationToken | AbortSignal): Promise<ProcessResult>;
    public async spawn(
        options: ForegroundProcessOptions | BackgroundJsonLinesProcessOptions | BackgroundJsonProcessOptions | BackgroundProcessOptions,
        cancellation?: vscode.CancellationToken | AbortSignal,
    ): Promise<void | ProcessResult | JsonProcessResult<unknown> | JsonLinesProcessResult> {
        if (options.execution === 'foreground') {
            return this.spawnForeground(options, cancellation);
        } else {
            return this.spawnBackground(options, cancellation);
        }
    }

    /** @inheritdoc */
    // eslint-disable-next-line @typescript-eslint/require-await
    public async isOnPath(command: string): Promise<boolean> {
        // Batch files are allowed so `.cmd` shims (the Azure CLI's `az.cmd`,
        // the Functions Core Tools' `func.cmd`) are reported as installed.
        return resolveExecutable(command, { allowWindowsBatchFiles: true }) !== undefined;
    }

    private async spawnForeground(options: ForegroundProcessOptions, cancellation?: vscode.CancellationToken | AbortSignal): Promise<void> {
        const task = createShellTask(this.code, {
            ...options,
            scope: options.workspaceFolder,
            presentationOptions: options.focus ? { focus: true } : undefined,
        });

        const taskExecution = await this.code.tasks.executeTask(task);

        const { signal, disposable } = toAbortSignal(cancellation);

        return new Promise<void>((resolve, reject) => {
            const endDisposable = this.code.tasks.onDidEndTaskProcess((e) => {
                if (e.execution === taskExecution) {
                    finish();
                    if (e.exitCode === 0) {
                        resolve();
                    } else {
                        reject(new Error(this.code.l10n.t(
                            "'{0}' failed with exit code {1}. See the '{0}' terminal for the full output.",
                            options.name,
                            e.exitCode ?? -1,
                        )));
                    }
                }
            });

            const onAbort = () => {
                finish();
                taskExecution.terminate();
                reject(new CancellationError());
            };

            const finish = () => {
                endDisposable.dispose();
                signal?.removeEventListener('abort', onAbort);
                disposable.dispose();
            };

            if (signal?.aborted) {
                onAbort();
            } else {
                signal?.addEventListener('abort', onAbort, { once: true });
            }
        });
    }

    private async spawnBackground(
        options: BackgroundProcessOptions | BackgroundJsonProcessOptions | BackgroundJsonLinesProcessOptions,
        cancellation?: vscode.CancellationToken | AbortSignal,
    ): Promise<ProcessResult | JsonProcessResult<unknown> | JsonLinesProcessResult> {
        const [executable, ...args] = argsToStrings(options.command);
        if (!executable) {
            throw new Error('A command line must include at least the executable as its first element.');
        }

        const { signal, disposable } = toAbortSignal(cancellation);

        let child: ChildProcess;
        try {
            child = this.spawnFn(executable, args, {
                cwd: options.cwd?.fsPath,
                // The child environment replaces `process.env` rather than
                // layering onto it, so merge the caller's overrides here.
                env: mergeProcessEnv(options.env),
                // Required so Windows `.cmd` shims (the Azure CLI's `az.cmd`)
                // resolve and launch; arguments are still escaped individually.
                allowWindowsBatchFiles: true,
                signal,
            });
        } catch (e) {
            disposable.dispose();
            throw asCancellation(e, signal);
        }

        const stdout = readAll(child.stdout);

        // JSON-lines mode streams stderr line-by-line rather than buffering it,
        // so the caller can observe progress while the process is still running.
        if ('jsonLines' in options && options.jsonLines) {
            const completed = (async (): Promise<JsonProcessResult<unknown>> => {
                try {
                    // stderr is streamed rather than buffered, so it is not
                    // captured on the completed result -- the caller consumes it
                    // live via `jsonLines`.
                    const out = await finish(child, stdout, Promise.resolve(''), signal);
                    return { stdout: out.stdout, stderr: '', json: JSON.parse(out.stdout) as unknown };
                } finally {
                    disposable.dispose();
                }
            })();

            // Mark the rejection as handled so a caller that only drains
            // `jsonLines` (and never awaits `completed`) doesn't trigger an
            // unhandled-rejection warning when the process fails. The original
            // `completed` promise is still returned, so awaiting it observes the
            // rejection normally.
            void completed.catch(() => undefined);

            return {
                jsonLines: parseJsonLines(readLines(child.stderr)),
                completed,
            };
        }

        let result: ProcessResult;
        try {
            result = await finish(child, stdout, readAll(child.stderr), signal);
        } finally {
            disposable.dispose();
        }

        if (options.parseJson) {
            const json: unknown = JSON.parse(result.stdout);
            return { ...result, json };
        }

        return result;
    }
}

/**
 * Awaits process exit alongside its captured output, and converts a failure
 * into the error callers expect.
 *
 * @throws {CancellationError} When the process was aborted via {@linkcode signal}.
 * @throws {ProcessError} When the process exited non-zero, was terminated by a
 *   signal, or failed to start.
 */
async function finish(
    child: ChildProcess,
    stdoutPromise: Promise<string>,
    stderrPromise: Promise<string>,
    signal: AbortSignal | undefined,
): Promise<ProcessResult> {
    const exit = new Promise<{ code: number | null; signalName: NodeJS.Signals | null }>((resolve, reject) => {
        child.once('error', reject);
        // 'close' rather than 'exit' so the stdio streams are fully flushed.
        child.once('close', (code: number | null, signalName: NodeJS.Signals | null) => { resolve({ code, signalName }); });
    });

    let stdout: string;
    let stderr: string;
    let code: number | null;
    let signalName: NodeJS.Signals | null;

    try {
        [stdout, stderr, { code, signalName }] = await Promise.all([stdoutPromise, stderrPromise, exit]);
    } catch (e) {
        throw asCancellation(e, signal);
    }

    if (signal?.aborted) {
        throw new CancellationError();
    }

    if (code === 0) {
        return { stdout, stderr };
    }

    // Append the captured stderr -- the tool's actual error text -- to the
    // generic exit-status message so callers surface something actionable.
    const summary = signalName !== null
        ? `The process was terminated by signal ${signalName}.`
        : `The process exited with code ${code}.`;
    const trimmed = stderr.trim();

    throw new ProcessError(trimmed ? `${summary}\n${trimmed}` : summary, {
        code: signalName !== null ? null : code,
        signal: signalName,
        killed: child.killed,
        stdout,
        stderr,
    });
}

/**
 * Maps an abort into {@linkcode CancellationError}, leaving every other error
 * unchanged.
 *
 * @remarks
 * An aborted child surfaces as a {@linkcode ProcessError} with code
 * `'ABORT_ERR'`, but a process killed just before its abort listener runs can
 * instead close normally, so {@linkcode signal} is consulted as well.
 */
function asCancellation(e: unknown, signal: AbortSignal | undefined): unknown {
    if (signal?.aborted || (isProcessError(e) && e.code === 'ABORT_ERR')) {
        return new CancellationError();
    }

    return e;
}

/**
 * Buffers a child stream to a string.
 *
 * @remarks
 * A stream error resolves with whatever was buffered rather than rejecting:
 * the child's `'error'`/`'close'` event is the authoritative failure signal, and
 * rejecting here would race it.
 */
function readAll(stream: Readable | null): Promise<string> {
    if (!stream) {
        return Promise.resolve('');
    }

    stream.setEncoding('utf8');

    return new Promise<string>((resolve) => {
        let buffer = '';
        stream.on('data', (chunk: string) => { buffer += chunk; });
        stream.once('end', () => { resolve(buffer); });
        stream.once('error', () => { resolve(buffer); });
    });
}

/**
 * Splits a child stream into lines as they arrive.
 *
 * @remarks
 * Ends silently on a stream error; the failure is surfaced by awaiting the
 * process instead.
 */
async function* readLines(stream: Readable | null): AsyncGenerator<string> {
    if (!stream) {
        return;
    }

    stream.setEncoding('utf8');

    let buffer = '';
    try {
        for await (const chunk of stream as AsyncIterable<string>) {
            buffer += chunk;

            let newline = buffer.indexOf('\n');
            while (newline >= 0) {
                yield buffer.slice(0, newline);
                buffer = buffer.slice(newline + 1);
                newline = buffer.indexOf('\n');
            }
        }
    } catch {
        // The failure is surfaced by awaiting the process in `completed`.
        return;
    }

    if (buffer.length > 0) {
        yield buffer;
    }
}

/** Parses newline-delimited JSON, skipping blank and non-JSON lines. */
async function* parseJsonLines(lines: AsyncIterable<string>): AsyncGenerator {
    for await (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) {
            continue;
        }

        try {
            yield JSON.parse(trimmed);
        } catch {
            // Not valid JSON -- skip the line
        }
    }
}
