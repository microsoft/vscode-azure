/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFunctionsHostClientProvider } from '@microsoft/vscode-azure-azutils';
import { CancellationError, delay, Disposable, ExternalError, IOutputChannel, IProcessExecutor, IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { randomUUID } from 'node:crypto';
import type * as vscode from 'vscode';
import { FunctionsHostTerminal } from './FunctionsHostTerminal';
import { LocalFunctionsHostTracker } from './LocalFunctionsHostTracker';
import { LocalFunctionsNetwork, type FunctionsPortReservation } from './LocalFunctionsNetwork';
import { workerProcessId } from './workerProcessId';

/** Inputs supplied after project validation and the build task have completed. */
export interface FunctionsHostStart {
    readonly project: vscode.Uri;
    readonly cwd: vscode.Uri;
    readonly executable: string;
    readonly runtime: string;
    readonly hostPort?: number;
    readonly debugPort?: number;
    readonly hostArgs: readonly string[];
    prepare(debugPort: number, pipe: string): Promise<Readonly<Record<string, string>>>;
}

/** Attach coordinates belonging to a process launched by this service, not an adopted host. */
export interface FunctionsHostAttachment {
    readonly id: string;
    readonly hostPort: number;
    readonly debugPort: number;
    readonly pipe: string;
    readonly workerPid?: number;
}

interface OwnedHost {
    readonly id: string;
    readonly project: vscode.Uri;
    readonly abort: AbortController;
    readonly terminal: FunctionsHostTerminal;
    readonly subscriptions: Disposable[];
    process?: Promise<void>;
    execution?: vscode.TaskExecution;
    registration?: Disposable;
    error?: Error;
    stopError?: Error;
    workerPid?: number;
}

/** Owns host tasks and their subprocesses; only an HTTP-ready owned host enters the project registry. */
@injectable()
export class LocalFunctionsHostProcess implements Disposable {
    private readonly hosts = new Map<string, OwnedHost>();
    private readonly starting = new Set<string>();
    private disposed = false;

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IProcessExecutor) private readonly processes: IProcessExecutor,
        @inject(IFunctionsHostClientProvider) private readonly client: IFunctionsHostClientProvider,
        @inject(LocalFunctionsHostTracker) private readonly tracker: LocalFunctionsHostTracker,
        @inject(LocalFunctionsNetwork) private readonly network: LocalFunctionsNetwork,
        @inject(IOutputChannel) private readonly output: IOutputChannel,
    ) { }

    /** Paused workers expose attach coordinates before full HTTP readiness, preventing an attach/readiness deadlock. */
    public async start(request: FunctionsHostStart, token?: vscode.CancellationToken): Promise<FunctionsHostAttachment> {
        if (this.disposed) { throw new CancellationError(); }
        const key = this.projectKey(request.project);
        if (this.starting.has(key) || [...this.hosts.values()].some(host => this.projectKey(host.project) === key)) {
            throw new ExternalError(this.code.l10n.t('This Functions project already has an owned host. Stop its debug session before starting another.'));
        }
        this.starting.add(key);
        try {
            return await this.startHost(request, token);
        } finally {
            this.starting.delete(key);
        }
    }

    private projectKey(uri: vscode.Uri): string {
        return process.platform === 'win32' ? uri.toString().toLowerCase() : uri.toString();
    }

    private async startHost(request: FunctionsHostStart, token?: vscode.CancellationToken): Promise<FunctionsHostAttachment> {
        const hostPort = await this.reserve(request.hostPort);
        let debugPort;
        try {
            debugPort = await this.reserve(request.debugPort);
        } catch (error) {
            await hostPort.release();
            throw error;
        }
        const id = randomUUID();
        const pipe = `azure-functions-${id}`;
        const abort = new AbortController();
        const terminal = new FunctionsHostTerminal(() => {
            if (!abort.signal.aborted) {
                this.launch(host, request, hostPort.port, env);
            }
        }, () => { abort.abort(); });
        const host: OwnedHost = { id, project: request.project, abort, terminal, subscriptions: [] };
        this.hosts.set(id, host);
        let released = false;
        let env: Readonly<Record<string, string>>;
        try {
            if (token?.isCancellationRequested || this.disposed) {
                throw new CancellationError();
            }
            if (token) {
                host.subscriptions.push(token.onCancellationRequested(() => { abort.abort(); }));
            }
            env = await request.prepare(debugPort.port, pipe);
            await Promise.all([hostPort.release(), debugPort.release()]);
            released = true;
            if (abort.signal.aborted) {
                throw new CancellationError();
            }
            const task = new this.code.Task(
                { type: 'azure-functions-host', id }, this.code.workspace.getWorkspaceFolder(request.project) ?? this.code.TaskScope.Workspace,
                this.code.l10n.t('Azure Functions Host'), 'Azure Functions',
                new this.code.CustomExecution(() => Promise.resolve(terminal)),
            );
            task.isBackground = true;
            task.presentationOptions = { reveal: this.code.TaskRevealKind.Always };
            host.execution = await this.code.tasks.executeTask(task);
            host.subscriptions.push(this.code.tasks.onDidEndTask(event => {
                if (event.execution === host.execution) { abort.abort(); }
            }));
            void this.waitForHttp(host, hostPort.port).catch((error: unknown) => {
                if (!CancellationError.test(error)) {
                    host.error ??= error instanceof ExternalError ? error
                        : new ExternalError(this.code.l10n.t('The Functions host did not become ready. See its terminal for details.'));
                    terminal.write(`${host.error.message}\n`);
                    this.output.warn(this.code.l10n.t('[functions] Owned host readiness failed.'));
                    abort.abort();
                }
            });
            const deadline = Date.now() + 120_000;
            while (Date.now() < deadline) {
                this.checkRunning(host);
                const ready = host.process && (request.runtime === 'dotnet-isolated' ? !!host.workerPid
                    : request.runtime === 'powershell' ? !!host.registration : await this.network.listening(debugPort.port));
                this.checkRunning(host);
                if (ready) {
                    return { id, hostPort: hostPort.port, debugPort: debugPort.port, pipe, workerPid: host.workerPid };
                }
                await delay(100, abort.signal);
            }
            throw new ExternalError(this.code.l10n.t('The Functions worker did not expose its debugger. See the host terminal for details.'));
        } catch (error) {
            await this.stop(id);
            throw host.error ?? error;
        } finally {
            if (!released) {
                await Promise.all([hostPort.release(), debugPort.release()]);
            }
        }
    }

    private async reserve(port?: number): Promise<FunctionsPortReservation> {
        try { return await this.network.reserve(port); }
        catch (error) {
            if (error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE') {
                throw new ExternalError(this.code.l10n.t('A configured Functions host or debugger port is already in use. Choose distinct available ports, or omit the port options.'));
            }
            throw error;
        }
    }

    /** Aborts only the identified owned process and waits for its subprocess completion. */
    public async stop(id: string): Promise<void> {
        const host = this.hosts.get(id);
        if (!host) { return; }
        host.abort.abort();
        host.registration?.dispose();
        host.execution?.terminate();
        host.terminal.close();
        await host.process;
        this.cleanup(host);
        if (host.stopError) { throw host.stopError; }
    }

    public dispose(): void {
        this.disposed = true;
        for (const id of this.hosts.keys()) {
            void this.stop(id).catch(() => {
                this.output.warn(this.code.l10n.t('[functions] Could not finish stopping an owned host.'));
            });
        }
    }

    private launch(host: OwnedHost, request: FunctionsHostStart, port: number, env: Readonly<Record<string, string>>): void {
        const args = ['host', 'start', ...request.hostArgs, '--address', '127.0.0.1', '--port', String(port)];
        if (request.runtime === 'dotnet-isolated') {
            args.push('--no-build', '--dotnet-isolated-debug', '--enable-json-output');
        }
        const buffers = { stdout: '', stderr: '' };
        host.process = this.processes.spawn({
            execution: 'background', command: [request.executable, ...args], cwd: request.cwd, env,
            killTreeOnCancel: true,
            onOutput: (text, stream) => {
                host.terminal.write(text);
                if (request.runtime === 'dotnet-isolated') {
                    const lines = (buffers[stream] + text).split(/\r?\n/);
                    buffers[stream] = (lines.pop() ?? '').slice(-16_384);
                    for (const line of lines) {
                        host.workerPid ??= workerProcessId(line);
                    }
                }
            },
        }, host.abort.signal).then(
            () => {
                if (!host.abort.signal.aborted) {
                    host.error = new ExternalError(this.code.l10n.t('The Functions host exited. See its terminal for details.'));
                    host.terminal.write(`${host.error.message}\n`);
                }
                this.cleanup(host);
                host.terminal.finish(0);
            },
            (error: unknown) => {
                if (host.abort.signal.aborted && !CancellationError.test(error)) {
                    host.stopError = new ExternalError(this.code.l10n.t('Could not terminate the owned Functions process tree. Check its terminal and stop the remaining processes before debugging again.'));
                    this.output.warn(this.code.l10n.t('[functions] Owned process-tree termination failed.'));
                }
                if (!host.abort.signal.aborted && !CancellationError.test(error)) {
                    host.error = new ExternalError(this.code.l10n.t('The Functions host failed. See its terminal for details.'));
                    host.terminal.write(`${host.error.message}\n`);
                    this.output.warn(this.code.l10n.t('[functions] Owned host process failed.'));
                }
                this.cleanup(host);
                host.terminal.finish(host.error || host.stopError ? 1 : 0);
            },
        );
    }

    private async waitForHttp(host: OwnedHost, port: number): Promise<void> {
        const client = this.client({ port });
        for (;;) {
            this.checkRunning(host);
            if (!host.process) {
                await delay(200, host.abort.signal);
                continue;
            }
            try {
                const status = await client.getStatus({ abortSignal: host.abort.signal, requestOptions: { timeout: 1000 } });
                this.checkRunning(host);
                if (status.state.toLowerCase() === 'running') {
                    host.registration = this.tracker.register(host.project, port);
                    return;
                }
                if (status.errors?.length) {
                    throw new ExternalError(this.code.l10n.t('The Functions host reported startup errors. See its terminal for details.'));
                }
            } catch (error) {
                if (CancellationError.test(error) || error instanceof ExternalError) { throw error; }
                if (error instanceof TypeError || (error && typeof error === 'object' && 'statusCode' in error
                    && typeof error.statusCode === 'number' && ![408, 429, 500, 502, 503, 504].includes(error.statusCode))) {
                    throw new ExternalError(this.code.l10n.t('The owned Functions host rejected its readiness request. Check local host authentication and its terminal.'));
                }
                this.output.trace('[functions] Waiting for the owned host HTTP endpoint.');
            }
            await delay(200, host.abort.signal);
        }
    }

    private checkRunning(host: OwnedHost): void {
        if (host.error) { throw host.error; }
        if (host.abort.signal.aborted) { throw new CancellationError(); }
    }

    private cleanup(host: OwnedHost): void {
        host.abort.abort();
        host.registration?.dispose();
        host.subscriptions.splice(0).forEach(disposable => { disposable.dispose(); });
        if (this.hosts.get(host.id) === host) { this.hosts.delete(host.id); }
    }
}
