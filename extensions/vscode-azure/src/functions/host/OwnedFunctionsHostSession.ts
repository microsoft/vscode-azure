/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IFunctionsHostClientProvider } from '@microsoft/vscode-azure-azutils';
import { CancellationError, delay, type Disposable, ExternalError, type IOutputChannel, type IProcessExecutor, type IVsCode } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';
import { BufferedPseudoterminal } from '../../utils/BufferedPseudoterminal';
import type { FunctionsHostStart } from './LocalFunctionsHostProcess';
import type { LocalFunctionsHostTracker } from './LocalFunctionsHostTracker';
import type { LocalFunctionsNetwork } from './LocalFunctionsNetwork';
import { workerProcessId } from './workerProcessId';

/** Services a session uses to run and observe its process. */
export interface OwnedFunctionsHostServices {
    readonly code: IVsCode;
    readonly processes: IProcessExecutor;
    readonly client: IFunctionsHostClientProvider;
    readonly tracker: LocalFunctionsHostTracker;
    readonly network: LocalFunctionsNetwork;
    readonly output: IOutputChannel;
}

/** Identity and launch inputs for one owned host. */
export interface OwnedFunctionsHostSessionInit {
    readonly id: string;
    readonly request: FunctionsHostStart;
    readonly hostPort: number;
    readonly debugPort: number;
    /** Runs once when the session has ended and its resources are released. */
    readonly onEnded: () => void;
}

/**
 * One launch of an owned Functions host: its task terminal, subprocess, readiness
 * channels and finalization. A single abort signal ends everything the session owns, and
 * {@linkcode stop} is the only way to end it deliberately.
 */
export class OwnedFunctionsHostSession {
    public readonly id: string;
    public readonly project: vscode.Uri;
    public readonly terminal: BufferedPseudoterminal;
    private readonly abort = new AbortController();
    private readonly subscriptions: Disposable[] = [];
    private env: Readonly<Record<string, string>> = {};
    private process?: Promise<void>;
    private execution?: vscode.TaskExecution;
    private registration?: Disposable;
    private error?: Error;
    private stopError?: Error;
    private workerPid?: number;
    private debuggerListening = false;
    private ended = false;

    public constructor(
        private readonly services: OwnedFunctionsHostServices,
        private readonly init: OwnedFunctionsHostSessionInit,
    ) {
        this.id = init.id;
        this.project = init.request.project;
        this.terminal = new BufferedPseudoterminal({
            onOpen: () => {
                if (!this.abort.signal.aborted) {
                    this.process = this.run();
                }
            },
            onClose: () => { this.abort.abort(); },
        });
    }

    /** The .NET isolated worker process id, once the host has reported it. */
    public get workerProcess(): number | undefined {
        return this.workerPid;
    }

    /** Ends the session when the token is cancelled. */
    public observe(token: vscode.CancellationToken | undefined): void {
        if (token?.isCancellationRequested) {
            throw new CancellationError();
        }
        if (token) {
            this.subscriptions.push(token.onCancellationRequested(() => { this.abort.abort(); }));
        }
    }

    /** Runs the host in a task terminal and begins watching its HTTP readiness; the process starts when VS Code opens the terminal. */
    public async execute(env: Readonly<Record<string, string>>): Promise<void> {
        const { code } = this.services;
        if (this.abort.signal.aborted) {
            throw new CancellationError();
        }
        this.env = env;
        const task = new code.Task(
            { type: 'azure-functions-host', id: this.id }, code.workspace.getWorkspaceFolder(this.project) ?? code.TaskScope.Workspace,
            code.l10n.t('Azure Functions Host'), 'Azure Functions',
            new code.CustomExecution(() => Promise.resolve(this.terminal)),
        );
        task.isBackground = true;
        task.presentationOptions = { reveal: code.TaskRevealKind.Always };
        this.execution = await code.tasks.executeTask(task);
        this.subscriptions.push(code.tasks.onDidEndTask(event => {
            if (event.execution === this.execution) { this.abort.abort(); }
        }));
        void this.waitForHttp().catch((error: unknown) => {
            if (!CancellationError.test(error)) {
                this.error ??= this.readinessError(error);
                this.terminal.write(`${this.error.message}\n`);
                this.services.output.warn(code.l10n.t('[functions] Owned host readiness failed.'));
                this.abort.abort();
            }
        });
    }

    /** Resolves when the language debugger can be attached; rejects if the host fails or the timeout elapses. */
    public async waitForDebugger(timeout: number): Promise<void> {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            this.checkRunning();
            const ready = await this.isDebuggerReady();
            this.checkRunning();
            if (ready) {
                return;
            }
            await delay(100, this.abort.signal);
        }
        throw new ExternalError(this.services.code.l10n.t('The Functions worker did not expose its debugger. See the host terminal for details.'));
    }

    /** Records and ends a failed start, returning the error to report. */
    public async fail(error: unknown): Promise<unknown> {
        if (this.execution && !this.error && !CancellationError.test(error)) {
            this.error = this.readinessError(error);
            this.terminal.write(`${this.error.message}\n`);
        }
        await this.stop();
        return this.error ?? error;
    }

    /** Aborts the owned process, waits for its subprocess completion, and rethrows a failed process-tree termination. Safe to call repeatedly. */
    public async stop(): Promise<void> {
        this.abort.abort();
        this.registration?.dispose();
        this.registration = undefined;
        if (this.process) {
            await this.process;
        } else {
            this.finalize();
        }
        if (this.stopError) { throw this.stopError; }
    }

    private readinessError(error: unknown): Error {
        return error instanceof ExternalError ? error
            : new ExternalError(this.services.code.l10n.t('The Functions host did not become ready. See its terminal for details.'));
    }

    private async isDebuggerReady(): Promise<boolean> {
        if (!this.process) {
            return false;
        }
        switch (this.init.request.runtime) {
            case 'dotnet-isolated':
                return this.workerPid !== undefined;
            case 'powershell':
                return this.registration !== undefined;
            case 'native':
                return this.debuggerListening && await this.services.network.listening(this.init.debugPort);
            default:
                return this.services.network.listening(this.init.debugPort);
        }
    }

    private async run(): Promise<void> {
        const { code, output } = this.services;
        const { request, hostPort } = this.init;
        const args = ['run', request.project.fsPath, ...request.hostArgs, '--port', String(hostPort)];
        if (request.skipBuild) {
            args.push('--no-build');
        }
        args.push('--no-azurite', '--output', request.runtime === 'dotnet-isolated' ? 'json' : 'plain');
        if (request.runtime === 'dotnet-isolated') {
            args.push('--dotnet-isolated-debug', '--enable-json-output');
        }
        try {
            const process = await this.services.processes.spawn({
                execution: 'background', command: [request.executable, ...args], cwd: request.project, env: this.env,
                killTreeOnCancel: true, streamOutput: true,
            }, this.abort.signal);
            try {
                await Promise.all([this.consumeOutput(process.stdout), this.consumeOutput(process.stderr)]);
            } catch {
                this.abort.abort();
                this.error ??= new ExternalError(code.l10n.t('The Functions host output stream failed. See its terminal for details.'));
                this.terminal.write(`${this.error.message}\n`);
                output.warn(code.l10n.t('[functions] Owned host output stream failed.'));
            } finally {
                await process.completed;
            }
            if (!this.abort.signal.aborted) {
                this.error = new ExternalError(code.l10n.t('The Functions host exited. See its terminal for details.'));
                this.terminal.write(`${this.error.message}\n`);
            }
        } catch (error: unknown) {
            if (this.abort.signal.aborted && !CancellationError.test(error)) {
                this.stopError = new ExternalError(code.l10n.t('Could not terminate the owned Functions process tree. Check its terminal and stop the remaining processes before debugging again.'));
                this.terminal.write(`${this.stopError.message}\n`);
                output.warn(code.l10n.t('[functions] Owned process-tree termination failed.'));
            }
            if (!this.abort.signal.aborted && !CancellationError.test(error)) {
                this.error = new ExternalError(request.runtime === 'native'
                    ? code.l10n.t('The Functions host failed. Native Go requires the Core Tools v5 Go worker workload. See its terminal for details.')
                    : code.l10n.t('The Functions host failed. See its terminal for details.'));
                this.terminal.write(`${this.error.message}\n`);
                output.warn(code.l10n.t('[functions] Owned host process failed.'));
            }
        } finally {
            this.finalize();
        }
    }

    private async consumeOutput(stream: AsyncIterable<string>): Promise<void> {
        const { runtime } = this.init.request;
        let pending = '';
        for await (const text of stream) {
            this.terminal.write(text);
            if (runtime !== 'dotnet-isolated' && runtime !== 'native') {
                continue;
            }
            const lines = (pending + text).split(/\r?\n/);
            pending = (lines.pop() ?? '').slice(-16_384);
            for (const line of lines) {
                if (runtime === 'dotnet-isolated') {
                    this.workerPid ??= workerProcessId(line);
                } else {
                    const listener = /(?:^|\s)API server listening at: 127\.0\.0\.1:(\d+)\s*$/.exec(line);
                    if (listener && Number(listener[1]) === this.init.debugPort) {
                        this.debuggerListening = true;
                    }
                }
            }
        }
    }

    private async waitForHttp(): Promise<void> {
        const { code, output, tracker } = this.services;
        const client = this.services.client({ port: this.init.hostPort });
        for (;;) {
            this.checkRunning();
            if (!this.process) {
                await delay(200, this.abort.signal);
                continue;
            }
            try {
                const status = await client.getStatus({ abortSignal: this.abort.signal, requestOptions: { timeout: 1000 } });
                this.checkRunning();
                if (status.state.toLowerCase() === 'running') {
                    this.registration = tracker.register(this.project, this.init.hostPort);
                    return;
                }
                if (status.errors?.length) {
                    throw new ExternalError(code.l10n.t('The Functions host reported startup errors. See its terminal for details.'));
                }
            } catch (error) {
                if (CancellationError.test(error) || error instanceof ExternalError) { throw error; }
                if (error instanceof TypeError || (error && typeof error === 'object' && 'statusCode' in error
                    && typeof error.statusCode === 'number' && ![408, 429, 500, 502, 503, 504].includes(error.statusCode))) {
                    throw new ExternalError(code.l10n.t('The owned Functions host rejected its readiness request. Check local host authentication and its terminal.'));
                }
                output.trace('[functions] Waiting for the owned host HTTP endpoint.');
            }
            await delay(200, this.abort.signal);
        }
    }

    private checkRunning(): void {
        if (this.error) { throw this.error; }
        if (this.abort.signal.aborted) { throw new CancellationError(); }
    }

    private finalize(): void {
        if (this.ended) { return; }
        this.ended = true;
        this.abort.abort();
        this.registration?.dispose();
        this.subscriptions.splice(0).forEach(disposable => { disposable.dispose(); });
        this.init.onEnded();
        if (this.error || this.stopError) {
            this.terminal.finish(1);
        } else {
            this.execution?.terminate();
            this.terminal.close();
        }
    }
}
