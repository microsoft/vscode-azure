/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ServiceIdentifier } from 'inversify';
import { default as spawn, type Options as SpawnOptions, type Result as SpawnResult, type Subprocess } from 'nano-spawn';
import type * as vscode from 'vscode';
import { default as which } from 'which';
import { CancellationError } from '../vscode/CancellationError';
import type { Disposable } from '../vscode/Disposable';
import type { IVsCode } from '../vscode/IVsCode';
import type { CancellationTokenLike } from './CancellationTokenLike';
import { ChildProcessError, isChildProcessError } from './ChildProcessError';
import { isCommandLineBuilder, type CommandLineArgs, type CommandLineBuilder } from './CommandLineBuilder';
import { getSafeExecPath } from './getSafeExecPath';
import { stringifyError } from './stringifyError';

export * from './CancellationTokenLike';
export * from './ChildProcessError';
export * from './CommandLineBuilder';
export * from './getSafeExecPath';

/**
 * Signature matching {@linkcode nano-spawn}'s default export. Exposed so tests
 * can inject a mock subprocess factory without replacing the module.
 */
export type SpawnFn = (command: string, args?: readonly string[], options?: SpawnOptions) => Subprocess;

/**
 * Shared options for all process execution modes.
 */
export interface ProcessExecutorOptions {
    /**
     * The command to run. Either a bare executable name/path, or a
     * {@linkcode CommandLineBuilder} that carries both the executable and its
     * arguments. When a builder is supplied, its arguments take precedence over
     * {@linkcode ProcessExecutorOptions.args args}.
     */
    readonly command: string | CommandLineBuilder;
    readonly args?: CommandLineArgs;
    readonly cwd?: vscode.Uri;
    readonly env?: Readonly<Record<string, string>>;
    /**
     * Runs the command through a shell (only honored for `'background'`
     * execution). Required on Windows to launch `.cmd`/`.bat` shims such as the
     * Azure CLI (`az`), which `child_process.spawn()` otherwise rejects with
     * `EINVAL`. Native executables (e.g. `azd`) should leave this unset.
     *
     * @remarks
     * Arguments are not shell-escaped, so only enable this for trusted,
     * program-controlled arguments.
     */
    readonly shell?: boolean | string;
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
 * - `'background'` -- runs via {@linkcode nano-spawn} and captures
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
 * @param spawnFn - Optional override for {@linkcode nano-spawn}'s default export,
 *   primarily for injecting a mock in unit tests. Defaults to the real
 *   implementation.
 */
export class ProcessExecutor implements IProcessExecutor {
    public constructor(
        private readonly code: IVsCode,
        private readonly spawnFn: SpawnFn = spawn,
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

    /** @inheritdoc */
    public async isOnPath(command: string): Promise<boolean> {
        try {
            await which(command);
            return true;
        } catch {
            return false;
        }
    }

    private async spawnForeground(options: ForegroundProcessOptions, cancellationToken?: CancellationTokenLike): Promise<void> {
        const { command, args } = resolveCommandLine(options);

        const shellExecution = new this.code.ShellExecution(
            getSafeExecPath(command),
            args,
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

            if (cancellationToken) {
                ctDisposable = cancellationToken.onCancellationRequested(() => {
                    taskExecution.terminate();
                    ctDisposable?.dispose();
                    endDisposable.dispose();
                    reject(new CancellationError());
                });
            }
        });
    }

    private async spawnBackground(
        options: BackgroundProcessOptions | BackgroundJsonProcessOptions | BackgroundJsonLinesProcessOptions,
        cancellationToken?: CancellationTokenLike,
    ): Promise<ProcessResult | JsonProcessResult<unknown> | JsonLinesProcessResult> {
        const { command, args } = resolveCommandLine(options);

        const controller = new AbortController();
        let canceled = false;
        let ctDisposable: Disposable | undefined;

        if (cancellationToken) {
            if (cancellationToken.isCancellationRequested) {
                canceled = true;
                controller.abort();
            } else {
                ctDisposable = cancellationToken.onCancellationRequested(() => {
                    canceled = true;
                    controller.abort();
                });
            }
        }

        // nano-spawn inherits `process.env` automatically and layers these
        // overrides on top, so pass only the caller-provided variables.
        const subprocess = this.spawnFn(command, toStringArgs(args), {
            cwd: options.cwd?.fsPath,
            env: options.env,
            shell: options.shell,
            signal: controller.signal,
        });

        // JSON-lines mode streams stderr line-by-line. The stderr must be
        // iterated eagerly (before nano-spawn starts buffering it), so tee it
        // now, synchronously, right after the subprocess is created.
        if ('jsonLines' in options && options.jsonLines) {
            const tee = new LineTee(subprocess.stderr);

            const completed = (async (): Promise<JsonProcessResult<unknown>> => {
                try {
                    const result = await subprocess;
                    await tee.whenDone;
                    const stdout = result.stdout;
                    return { stdout, stderr: tee.lines.join('\n'), json: JSON.parse(stdout) as unknown };
                } catch (e) {
                    await tee.whenDone.catch(() => { /* surfaced below */ });
                    const stderr = tee.lines.join('\n') || subprocessStderr(e);
                    throw enrichError(e, stderr, canceled);
                } finally {
                    ctDisposable?.dispose();
                }
            })();

            return {
                jsonLines: parseJsonLines(tee),
                completed,
            };
        }

        let result: SpawnResult;
        try {
            result = await subprocess;
        } catch (e) {
            throw enrichError(e, subprocessStderr(e), canceled);
        } finally {
            ctDisposable?.dispose();
        }

        const { stdout, stderr } = result;

        if (options.parseJson) {
            const json: unknown = JSON.parse(stdout);
            return { stdout, stderr, json };
        }

        return { stdout, stderr };
    }
}

/**
 * Resolves the executable and argument list from the options, honoring a
 * {@linkcode CommandLineBuilder} when one is supplied as the command.
 */
function resolveCommandLine(options: ProcessExecutorOptions): { command: string; args: CommandLineArgs } {
    if (isCommandLineBuilder(options.command)) {
        return { command: options.command.command, args: options.command.toArray() };
    }
    return { command: options.command, args: options.args ? [...options.args] : [] };
}

/** Flattens a {@linkcode CommandLineArgs} list to plain strings for argv-first execution. */
function toStringArgs(args: CommandLineArgs): string[] {
    return args.map((arg) => typeof arg === 'string' ? arg : arg.value);
}

/**
 * Minimal shape of nano-spawn's `SubprocessError`, recognized structurally so
 * that both the real error and test fakes are handled.
 */
interface SubprocessErrorLike extends Error {
    readonly exitCode?: number;
    readonly signalName?: string;
    readonly isCanceled?: boolean;
    readonly stderr?: string;
}

function isSubprocessError(e: unknown): e is SubprocessErrorLike {
    return e instanceof Error && e.name === 'SubprocessError';
}

/** Extracts captured stderr from a spawn failure, if any. */
function subprocessStderr(e: unknown): string {
    return isSubprocessError(e) && typeof e.stderr === 'string' ? e.stderr : '';
}

/**
 * Maps a background spawn failure onto the errors callers expect.
 *
 * @param e - The rejection from the subprocess.
 * @param stderr - Captured stderr used to enrich the message.
 * @param canceled - Whether cancellation was requested via the token.
 * @returns
 * - {@linkcode CancellationError} when canceled.
 * - {@linkcode ChildProcessError} (with `.cause` set) when the process ran and
 *   exited non-zero or was terminated by a signal.
 * - The original spawn-time error (e.g. `ENOENT`) when the process never
 *   started, so callers can still inspect its `code`.
 * - The error unchanged for anything else.
 */
function enrichError(e: unknown, stderr: string, canceled: boolean): unknown {
    if (canceled || (isSubprocessError(e) && e.isCanceled)) {
        return new CancellationError();
    }

    if (isChildProcessError(e)) {
        return e;
    }

    if (isSubprocessError(e)) {
        const hasExitCode = typeof e.exitCode === 'number';
        const hasSignal = typeof e.signalName === 'string';

        // No exit code and no signal means the process never started (e.g.
        // ENOENT/EINVAL). Surface the underlying error so its `code` survives.
        if (!hasExitCode && !hasSignal) {
            return (e as { cause?: unknown }).cause ?? e;
        }

        const msg = stderr.trim() || stringifyError(e);
        const enriched = new ChildProcessError(
            msg,
            typeof e.exitCode === 'number' ? e.exitCode : -1,
            hasSignal ? (e.signalName as NodeJS.Signals) : null,
        );
        enriched.cause = e;
        return enriched;
    }

    return e;
}

/**
 * Parses newline-delimited JSON from a {@linkcode LineTee}, skipping blank and
 * non-JSON lines.
 */
async function* parseJsonLines(tee: LineTee): AsyncGenerator {
    for await (const line of tee.lineStream()) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
            try {
                yield JSON.parse(trimmed);
            } catch {
                // Not valid JSON -- skip the line
            }
        }
    }
}

/**
 * Eagerly consumes an async line iterable (nano-spawn's `subprocess.stderr`),
 * both accumulating every line and re-broadcasting them to a lazily-consumed
 * {@linkcode LineTee.lineStream stream}.
 *
 * @remarks
 * nano-spawn disables output buffering for a stream as soon as it is iterated,
 * and requires that iteration to begin immediately. Pumping here (from the
 * constructor, in the same tick the subprocess is created) satisfies both
 * constraints while still letting the caller drain the parsed lines at its own
 * pace and read the full accumulated {@linkcode LineTee.lines stderr} afterward.
 */
class LineTee {
    /** Every line emitted by the source, in order. */
    public readonly lines: string[] = [];
    /** Resolves when the source has been fully consumed (successfully or not). */
    public readonly whenDone: Promise<void>;

    private readonly buffered: string[] = [];
    private readonly waiters: Array<(result: IteratorResult<string, void>) => void> = [];
    private ended = false;

    public constructor(source: AsyncIterable<string>) {
        this.whenDone = this.pump(source);
    }

    /** Lazily yields each line as it becomes available, then completes. */
    public async *lineStream(): AsyncGenerator<string> {
        while (!this.ended || this.buffered.length > 0) {
            const next = this.buffered.shift();
            if (next !== undefined) {
                yield next;
                continue;
            }
            const result = await new Promise<IteratorResult<string, void>>((resolve) => this.waiters.push(resolve));
            if (!result.done) {
                yield result.value;
            }
        }
    }

    private async pump(source: AsyncIterable<string>): Promise<void> {
        try {
            for await (const line of source) {
                this.lines.push(line);
                this.emit(line);
            }
        } catch {
            // The failure is surfaced by awaiting the subprocess in `completed`.
        } finally {
            this.finish();
        }
    }

    private emit(line: string): void {
        const waiter = this.waiters.shift();
        if (waiter) {
            waiter({ value: line, done: false });
        } else {
            this.buffered.push(line);
        }
    }

    private finish(): void {
        this.ended = true;
        for (const waiter of this.waiters.splice(0)) {
            waiter({ value: undefined, done: true });
        }
    }
}
