/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile, isProcessError, ProcessError, resolveExecutable, spawn, type SpawnOptions } from '@azure/core-process';
import type { ServiceIdentifier } from 'inversify';
import type { ChildProcess } from 'node:child_process';
import { on } from 'node:events';
import * as readline from 'node:readline';
import type { Readable } from 'node:stream';
import type * as vscode from 'vscode';
import { CancellationError } from '../vscode/CancellationError';
import { createShellTask } from '../vscode/createShellTask';
import type { IVsCode } from '../vscode/IVsCode';
import { argsToStrings, type CommandLineArgs } from './CommandLineBuilder';
import { mergeProcessEnv } from './mergeProcessEnv';
import { toAbortSignal, type AbortSignalBridge } from './toAbortSignal';

export * from './CommandLineBuilder';
export { isProcessError, ProcessError } from '@azure/core-process';

/**
 * Signature matching {@linkcode spawn} from `@azure/core-process`. Exposed so
 * tests can inject a mock subprocess factory without replacing the module.
 */
export type SpawnFn = (command: string, args?: readonly string[], options?: SpawnOptions) => ChildProcess;

/**
 * Signature matching {@linkcode resolveExecutable} from `@azure/core-process`.
 * Exposed so tests can inject a resolver without replacing the module.
 */
export type ResolveExecutableFn = typeof resolveExecutable;

/** Terminates an owned POSIX process group or Windows process tree; rejects if termination fails. */
export type KillProcessTreeFn = (pid: number) => Promise<void>;

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
    readonly streamOutput?: false;
    /** Forcefully terminates the owned process tree on cancellation, and waits for that operation to finish. */
    readonly killTreeOnCancel?: boolean;
}

/** Streams decoded stdout/stderr chunks instead of capturing process output. */
export interface BackgroundStreamingProcessOptions extends ProcessExecutorOptions {
    readonly execution: 'background';
    readonly streamOutput: true;
    readonly parseJson?: false;
    readonly jsonLines?: false;
    /** Forcefully terminates the owned process tree on cancellation, and waits for that operation to finish. */
    readonly killTreeOnCancel?: boolean;
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
    /** VS Code problem matchers applied to the generated build task. */
    readonly problemMatchers?: string | string[];
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
 * Live process output and its independently observable completion.
 *
 * Consume {@linkcode stdout} and {@linkcode stderr} concurrently while awaiting
 * {@linkcode completed}; unread output applies backpressure and can prevent
 * the process from exiting. Breaking out of either generator discards that
 * channel's remaining output without terminating the process.
 *
 * Completion resolves without a value; process errors contain no captured output.
 * Process failures, cancellation, and termination failures are reported by
 * {@linkcode completed}, and terminate both generators. Stream I/O errors can
 * also reject a generator. Use the spawn cancellation signal to stop the process.
 */
export interface StreamingProcessResult {
    readonly stdout: AsyncGenerator<string>;
    readonly stderr: AsyncGenerator<string>;
    readonly completed: Promise<void>;
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
 * The caller **must** start iterating {@linkcode jsonLines} (e.g. via
 * `for await`). Nothing reads stderr until the first line is pulled, so a
 * result whose stream is never touched leaves a chatty child blocked on its
 * own output, and {@linkcode completed} then never settles. Stopping early is
 * safe: the remainder is discarded and the process runs to completion.
 *
 * The caller must also await {@linkcode completed} to observe process and JSON
 * parsing failures; consuming the generator alone does not report them.
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
 *   stdout/stderr. Supports optional raw output streaming, JSON parsing, and JSON-lines streaming.
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
    /** Starts a background process and returns its output generator and completion promise. */
    spawn(options: BackgroundStreamingProcessOptions, cancellation?: vscode.CancellationToken | AbortSignal): Promise<StreamingProcessResult>;
    /** Runs a background process and captures raw stdout and stderr. */
    spawn(options: BackgroundProcessOptions, cancellation?: vscode.CancellationToken | AbortSignal): Promise<ProcessResult>;

    /** Resolves a command to its absolute executable path, or returns `undefined` when it is not found. */
    resolveExecutable(command: string): string | undefined;
    /** Tests whether a command is available on the system `PATH`. */
    isOnPath(command: string): boolean;
    /**
     * Forcefully terminates an owned POSIX process group or Windows process tree.
     *
     * On POSIX, {@linkcode pid} must identify the dedicated process group created
     * by launching with `killTreeOnCancel: true`, not an arbitrary child PID.
     * Callers must own the target and await process completion separately.
     * A missing POSIX group is already stopped; other termination failures reject.
     *
     * @throws {RangeError} When the PID is outside the integer range 2..2147483647.
     */
    killProcessTree(pid: number): Promise<void>;
}

/**
 * Default implementation of {@linkcode IProcessExecutor}.
 *
 * @param code - The VS Code API surface for task execution.
 * @param spawnFn - Optional override for `@azure/core-process`'s
 *   {@linkcode spawn}, primarily for injecting a mock in unit tests. Defaults to
 *   the real implementation.
 * @param resolveExecutableFn - Optional override for
 *   `@azure/core-process`'s {@linkcode resolveExecutable}, primarily for
 *   injecting a mock in unit tests. Defaults to the real implementation.
 * @param killProcessTreeFn - Optional process-tree termination seam for tests.
 */
export class ProcessExecutor implements IProcessExecutor {
    public constructor(
        private readonly code: IVsCode,
        private readonly spawnFn: SpawnFn = spawn,
        private readonly resolveExecutableFn: ResolveExecutableFn = resolveExecutable,
        private readonly killProcessTreeFn?: KillProcessTreeFn,
    ) { }

    public async spawn(options: ForegroundProcessOptions, cancellation?: vscode.CancellationToken | AbortSignal): Promise<void>;
    public async spawn<TOut = unknown, TLines = unknown>(options: BackgroundJsonLinesProcessOptions, cancellation?: vscode.CancellationToken | AbortSignal): Promise<JsonLinesProcessResult<TOut, TLines>>;
    public async spawn<T = unknown>(options: BackgroundJsonProcessOptions, cancellation?: vscode.CancellationToken | AbortSignal): Promise<JsonProcessResult<T>>;
    public async spawn(options: BackgroundStreamingProcessOptions, cancellation?: vscode.CancellationToken | AbortSignal): Promise<StreamingProcessResult>;
    public async spawn(options: BackgroundProcessOptions, cancellation?: vscode.CancellationToken | AbortSignal): Promise<ProcessResult>;
    public async spawn(
        options: ForegroundProcessOptions | BackgroundJsonLinesProcessOptions | BackgroundJsonProcessOptions | BackgroundStreamingProcessOptions | BackgroundProcessOptions,
        cancellation?: vscode.CancellationToken | AbortSignal,
    ): Promise<void | ProcessResult | JsonProcessResult<unknown> | JsonLinesProcessResult | StreamingProcessResult> {
        if (options.execution === 'foreground') {
            return this.spawnForeground(options, cancellation);
        } else {
            return this.spawnBackground(options, cancellation);
        }
    }

    /** @inheritdoc */
    public resolveExecutable(command: string): string | undefined {
        // Batch files are allowed so `.cmd` shims (the Azure CLI's `az.cmd`,
        // the Functions Core Tools' `func.cmd`) can be resolved.
        const resolved = this.resolveExecutableFn(command, { allowWindowsBatchFiles: true });
        // Normalize any falsy result to `undefined`, so callers have a single
        // value to test for "not found".
        return resolved || undefined;
    }

    /** @inheritdoc */
    public isOnPath(command: string): boolean {
        return !!this.resolveExecutable(command);
    }

    /** @inheritdoc */
    public async killProcessTree(pid: number): Promise<void> {
        // Negating 0 or 1 has special POSIX kill semantics, not group ownership.
        if (!Number.isInteger(pid) || pid <= 1 || pid > 0x7fffffff) {
            throw new RangeError(this.code.l10n.t('The process ID must be an integer between 2 and 2147483647.'));
        }

        if (this.killProcessTreeFn) {
            await this.killProcessTreeFn(pid);
            return;
        }

        if (process.platform === 'win32') {
            await execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
            return;
        }

        try {
            process.kill(-pid, 'SIGKILL');
        } catch (error: unknown) {
            if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH')) {
                throw error;
            }
        }
    }

    private async spawnForeground(options: ForegroundProcessOptions, cancellation?: vscode.CancellationToken | AbortSignal): Promise<void> {
        const task = createShellTask(this.code, {
            ...options,
            scope: options.workspaceFolder,
            presentationOptions: options.focus ? { focus: true } : undefined,
        }, this.resolveExecutableFn);

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
        options: BackgroundProcessOptions | BackgroundStreamingProcessOptions | BackgroundJsonProcessOptions | BackgroundJsonLinesProcessOptions,
        cancellation?: vscode.CancellationToken | AbortSignal,
    ): Promise<ProcessResult | JsonProcessResult<unknown> | JsonLinesProcessResult | StreamingProcessResult> {
        const [executable, ...args] = argsToStrings(options.command);
        if (!executable) {
            throw new Error('A command line must include at least the executable as its first element.');
        }

        const { signal, disposable } = toAbortSignal(cancellation);
        const killTreeOnCancel = 'killTreeOnCancel' in options && options.killTreeOnCancel === true;

        let child: ChildProcess;
        try {
            if (killTreeOnCancel && signal?.aborted) {
                throw new CancellationError();
            }
            child = this.spawnFn(executable, args, {
                cwd: options.cwd?.fsPath,
                // The child environment replaces `process.env` rather than
                // layering onto it, so merge the caller's overrides here.
                env: mergeProcessEnv(options.env),
                // An explicit opt-in: without it, resolution of a `.cmd`/`.bat`
                // target fails with ENOENT, so Windows shims (the Azure CLI's
                // `az.cmd`) would never launch. Only resolution is gated -- the
                // batch-specific argument escaping is applied automatically once
                // the resolved target turns out to be a batch file.
                allowWindowsBatchFiles: true,
                // POSIX descendants inherit this dedicated group. Windows uses
                // taskkill's tree traversal without changing the launch mode.
                detached: killTreeOnCancel && process.platform !== 'win32',
                // Owned-tree cancellation must finish group/tree termination,
                // rather than letting spawn abort only the direct child.
                signal: killTreeOnCancel ? undefined : signal,
            });
        } catch (e) {
            disposable.dispose();
            throw asCancellation(e, signal);
        }

        let outputAbort: AbortController | undefined;
        let streamedOutput: Pick<StreamingProcessResult, 'stdout' | 'stderr'> | undefined;
        let jsonLines: AsyncGenerator | undefined;
        let stdout: Promise<string>;
        let stderr: Promise<string>;

        if ('streamOutput' in options && options.streamOutput) {
            outputAbort = new AbortController();
            streamedOutput = {
                stdout: readChunks(child.stdout, outputAbort.signal),
                stderr: readChunks(child.stderr, outputAbort.signal),
            };
            // Raw output belongs to the generators, not captured results/errors.
            stdout = Promise.resolve('');
            stderr = Promise.resolve('');
        } else {
            // Drain captured stdout immediately. A full stdout pipe can block
            // the child before it emits the stderr progress the caller awaits.
            stdout = readAll(child.stdout);
            if ('jsonLines' in options && options.jsonLines) {
                jsonLines = parseJsonLines(readLines(child.stderr));
                // JSONL stderr is consumed live and must not also be buffered.
                stderr = Promise.resolve('');
            } else {
                stderr = readAll(child.stderr);
            }
        }

        const completed = this.completeBackgroundProcess(
            child,
            finish(child, stdout, stderr, signal),
            { signal, disposable },
            killTreeOnCancel,
            outputAbort,
        );

        if (streamedOutput) {
            const streamed = completed.then(() => undefined);
            // Consumers may drain output before awaiting completion. Mark its
            // rejection handled without changing the promise they receive.
            void streamed.catch(() => undefined);
            return { ...streamedOutput, completed: streamed };
        }

        if (options.parseJson) {
            const parsed = completed.then(result => ({
                ...result,
                json: JSON.parse(result.stdout) as unknown,
            }));

            if (jsonLines) {
                // As with raw streaming, progress can be consumed before the
                // caller observes process or JSON parsing failure.
                void parsed.catch(() => undefined);
                return { jsonLines, completed: parsed };
            }

            return parsed;
        }

        return completed;
    }

    /** Owns cancellation and cleanup independently of how the output is consumed. */
    private async completeBackgroundProcess(
        child: ChildProcess,
        exited: Promise<ProcessResult>,
        { signal, disposable }: AbortSignalBridge,
        killTreeOnCancel: boolean,
        outputAbort?: AbortController,
    ): Promise<ProcessResult> {
        let pending = exited;
        let termination: Promise<void> | undefined;
        let onAbort: (() => void) | undefined;

        if (killTreeOnCancel && signal) {
            const terminationFailed = Promise.withResolvers<never>();
            onAbort = () => {
                const pid = child.pid;
                const leaderExited = child.exitCode !== null || child.signalCode !== null;
                if (!pid || (process.platform === 'win32' && leaderExited)) {
                    return;
                }

                // A POSIX group may outlive its leader while workers hold the
                // pipes open. Signal the group even if the direct child exited.
                termination ??= Promise.resolve().then(() => this.killProcessTree(pid));
                void termination.catch(terminationFailed.reject);
            };

            // A failed kill can leave the child alive indefinitely. Report the
            // failure without waiting for a close event that may never arrive.
            pending = Promise.race([exited, terminationFailed.promise]);
            signal.addEventListener('abort', onAbort, { once: true });
            if (signal.aborted) {
                onAbort();
            }
        }

        try {
            return await pending;
        } catch (error) {
            // Wake generators waiting on idle pipes when the process cannot
            // close, including when process-tree termination itself failed.
            outputAbort?.abort();
            throw error;
        } finally {
            if (onAbort) {
                signal?.removeEventListener('abort', onAbort);
            }
            disposable.dispose();
            // Child closure can precede completion of process-tree termination.
            await termination;
        }
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

/** Uses native event-iterator backpressure; abandoning a channel drains its remaining bytes. */
function readChunks(stream: Readable | null, signal: AbortSignal): AsyncGenerator<string> {
    stream?.setEncoding('utf8');

    // Subscribe before returning control so fast startup output is not lost.
    // Node pauses the source when its event queue exceeds the high-water mark.
    const chunks = stream ? on(stream, 'data', {
        close: ['end', 'close'],
        signal,
        highWaterMark: 1,
        lowWaterMark: 1,
    }) : undefined;

    async function* output(): AsyncGenerator<string> {
        if (!stream || !chunks) {
            return;
        }

        try {
            for await (const [text] of chunks) {
                if (typeof text !== 'string') {
                    throw new TypeError('Expected decoded process output.');
                }
                yield text;
            }
        } catch (error: unknown) {
            // Process/cancellation errors are reported through completed;
            // unrelated stream errors still belong to the output consumer.
            const cancelled = signal.aborted && error instanceof Error && error.name === 'AbortError';
            if (!cancelled) {
                throw error;
            }
        } finally {
            // An early consumer exit must not leave the child blocked writing.
            stream.resume();
        }
    }

    return output();
}

/**
 * Splits a child stream into lines as they arrive, accepting either `\n` or
 * `\r\n` as the terminator.
 *
 * @remarks
 * Ends silently on a stream error; the failure is surfaced by awaiting the
 * process instead.
 *
 * A consumer that stops early (`break`, `return`, or a `throw`) leaves the
 * stream paused, which would block the child on its next write and prevent it
 * from ever exiting. Resuming discards the remainder instead, so the process
 * still runs to completion and its result stays observable.
 */
async function* readLines(stream: Readable | null): AsyncGenerator<string> {
    if (!stream) {
        return;
    }

    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

    try {
        yield* lines;
    } catch {
        // The failure is surfaced by awaiting the process in `completed`.
    } finally {
        lines.close();
        stream.resume();
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
