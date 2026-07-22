/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ServiceIdentifier } from 'inversify';
import { SubprocessError, default as spawn, type Options as SpawnOptions, type Result as SpawnResult, type Subprocess } from 'nano-spawn';
import type * as vscode from 'vscode';
import { CancellationError } from '../vscode/CancellationError';
import type { IVsCode } from '../vscode/IVsCode';
import { argToString, argsToStrings, type CommandLineArgs } from './CommandLineBuilder';
import { findOnPath, getSafeExecPath } from './getSafeExecPath';
import { toAbortSignal } from './toAbortSignal';

export * from './CommandLineBuilder';
export * from './getSafeExecPath';
export { SubprocessError } from 'nano-spawn';

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
 * - `'background'` -- runs via {@linkcode nano-spawn} and captures
 *   stdout/stderr. Supports optional JSON parsing and JSON-lines streaming.
 * - `'foreground'` -- runs as a {@linkcode vscode.Task Task} visible in the
 *   integrated terminal. Returns `Promise<void>` since task output is not
 *   capturable.
 *
 * On failure, background execution throws {@linkcode nano-spawn}'s
 * `SubprocessError` (with captured stderr appended to the message). Foreground
 * failure throws a plain {@linkcode Error}. Cancellation -- via a
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
 * @param spawnFn - Optional override for {@linkcode nano-spawn}'s default export,
 *   primarily for injecting a mock in unit tests. Defaults to the real
 *   implementation.
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
    public async isOnPath(command: string): Promise<boolean> {
        return (await findOnPath(command)) !== undefined;
    }

    private async spawnForeground(options: ForegroundProcessOptions, cancellation?: vscode.CancellationToken | AbortSignal): Promise<void> {
        const { command, args } = await resolveCommandLine(options);

        const shellExecution = new this.code.ShellExecution(
            command,
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
        const { command, args } = await resolveCommandLine(options);

        const { signal, disposable } = toAbortSignal(cancellation);

        // nano-spawn inherits `process.env` automatically and layers these
        // overrides on top, so pass only the caller-provided variables.
        const subprocess = this.spawnFn(command, argsToStrings(args), {
            cwd: options.cwd?.fsPath,
            env: options.env,
            shell: options.shell,
            signal,
        });

        // JSON-lines mode streams stderr line-by-line. nano-spawn requires the
        // stderr iteration to begin in the same tick the subprocess was created
        // (and disables buffering once iterated), so prime the iterator
        // synchronously here and hand the first pull to the parser.
        if ('jsonLines' in options && options.jsonLines) {
            const stderrIterator = subprocess.stderr[Symbol.asyncIterator]();
            const firstPull = stderrIterator.next();

            const completed = (async (): Promise<JsonProcessResult<unknown>> => {
                try {
                    const result = await subprocess;
                    // stderr was streamed (buffering disabled), so it is not
                    // captured on the completed result -- the caller consumes it
                    // live via `jsonLines`.
                    return { stdout: result.stdout, stderr: '', json: JSON.parse(result.stdout) as unknown };
                } catch (e) {
                    throw enrichError(e, subprocessStderr(e));
                } finally {
                    disposable.dispose();
                }
            })();

            return {
                jsonLines: parseJsonLines(stderrIterator, firstPull),
                completed,
            };
        }

        let result: SpawnResult;
        try {
            result = await subprocess;
        } catch (e) {
            throw enrichError(e, subprocessStderr(e));
        } finally {
            disposable.dispose();
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
 * Splits an {@linkcode ProcessExecutorOptions.command argument vector} into the
 * executable and its trailing arguments for execution.
 *
 * The executable is resolved to a safe absolute path via
 * {@linkcode getSafeExecPath} so that neither foreground nor background execution
 * can be hijacked by a same-named binary in the current working directory on
 * Windows. Under a shell, nano-spawn concatenates the command and arguments into
 * a single unquoted string, so a resolved path containing a space would be
 * mis-split; only in that case is the resolution discarded and the
 * (caller-trusted) bare command left for the shell to resolve. A space-free
 * resolved path is safe to pass through a shell, so the cwd-hijack mitigation is
 * preserved for those commands.
 *
 * @throws {Error} When the vector is empty (no executable to run).
 */
async function resolveCommandLine(options: ProcessExecutorOptions): Promise<{ command: string; args: CommandLineArgs }> {
    if (options.command.length === 0) {
        throw new Error('A command line must include at least the executable as its first element.');
    }
    const [executable, ...args] = options.command;
    const command = argToString(executable);

    const safePath = await getSafeExecPath(command);

    // A shell space-joins the command and arguments without quoting, so a
    // resolved path containing a space would be mis-split. Only then fall back to
    // the bare command and let the shell resolve it; a space-free resolved path
    // keeps the cwd-hijack mitigation intact.
    if (options.shell && safePath.includes(' ')) {
        return { command, args };
    }

    return { command: safePath, args };
}

/** Extracts captured stderr from a spawn failure, if any. */
function subprocessStderr(e: unknown): string {
    return e instanceof SubprocessError && typeof e.stderr === 'string' ? e.stderr : '';
}

/**
 * Maps a background spawn failure onto the errors callers expect.
 *
 * @param e - The rejection from the subprocess.
 * @param stderr - Captured stderr appended to the message when the process ran.
 * @returns
 * - {@linkcode CancellationError} when the subprocess was aborted via its signal.
 * - The {@linkcode nano-spawn} `SubprocessError` (with captured stderr appended
 *   to its `message`) when the process ran and exited non-zero or was terminated
 *   by a signal.
 * - The original spawn-time error (e.g. `ENOENT`) when the process never
 *   started, so callers can still inspect its `code`.
 * - The error unchanged for anything else.
 */
function enrichError(e: unknown, stderr: string): unknown {
    if (e instanceof SubprocessError && e.isCanceled) {
        return new CancellationError();
    }

    if (e instanceof SubprocessError) {
        const hasExitCode = typeof e.exitCode === 'number';
        const hasSignal = typeof e.signalName === 'string';

        // No exit code and no signal means the process never started (e.g.
        // ENOENT/EINVAL). Surface the underlying error so its `code` survives.
        if (!hasExitCode && !hasSignal) {
            return (e as { cause?: unknown }).cause ?? e;
        }

        // Append captured stderr (the tool's actual error text) to nano-spawn's
        // generic "exit code" message.
        const trimmed = stderr.trim();
        if (trimmed) {
            e.message = `${e.message}\n${trimmed}`;
        }
        return e;
    }

    return e;
}

/**
 * Parses newline-delimited JSON from a live stderr line iterator, skipping blank
 * and non-JSON lines.
 *
 * @remarks
 * nano-spawn requires its `stderr` iterable to be consumed in the same tick the
 * subprocess is created. The caller primes the iterator with a synchronous first
 * {@linkcode AsyncIterator.next next} call and passes that pending result in as
 * {@linkcode firstPull} so this generator can be driven lazily afterwards. A pull
 * that rejects (the subprocess failed) simply ends the stream -- the failure is
 * surfaced by awaiting the subprocess in `completed`.
 */
async function* parseJsonLines(
    iterator: AsyncIterator<string>,
    firstPull: Promise<IteratorResult<string>>,
): AsyncGenerator {
    let pull = firstPull;
    for (; ;) {
        let result: IteratorResult<string>;

        try {
            result = await pull;
        } catch {
            // The failure is surfaced by awaiting the subprocess in `completed`.
            return;
        }

        if (result.done) {
            return;
        }

        const trimmed = result.value.trim();
        if (trimmed.length > 0) {
            try {
                yield JSON.parse(trimmed);
            } catch {
                // Not valid JSON -- skip the line
            }
        }

        pull = iterator.next();
    }
}
