/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFunctionsHostClientProvider } from '@microsoft/vscode-azure-azutils';
import { CancellationError, Disposable, ExternalError, IOutputChannel, IProcessExecutor, IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { randomUUID } from 'node:crypto';
import type * as vscode from 'vscode';
import { LocalFunctionsHostTracker } from './LocalFunctionsHostTracker';
import { LocalFunctionsNetwork, type FunctionsPortReservation } from './LocalFunctionsNetwork';
import { OwnedFunctionsHostSession } from './OwnedFunctionsHostSession';

/** Inputs supplied after project validation and any custom or Go debug build. */
export interface FunctionsHostStart {
    readonly project: vscode.Uri;
    readonly executable: string;
    readonly runtime: string;
    /** Suppresses CLI compilation; dependency restoration still follows the stack's CLI contract. */
    readonly skipBuild: boolean;
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

/** Owns host tasks and their subprocesses; only an HTTP-ready owned host enters the project registry. */
@injectable()
export class LocalFunctionsHostProcess implements Disposable {
    private readonly hosts = new Map<string, OwnedFunctionsHostSession>();
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
        const session = new OwnedFunctionsHostSession(
            { code: this.code, processes: this.processes, client: this.client, tracker: this.tracker, network: this.network, output: this.output },
            { id, request, hostPort: hostPort.port, debugPort: debugPort.port, onEnded: () => { this.hosts.delete(id); } },
        );
        this.hosts.set(id, session);
        let released = false;
        try {
            if (this.disposed) {
                throw new CancellationError();
            }
            session.observe(token);
            const env = await request.prepare(debugPort.port, pipe);
            await Promise.all([hostPort.release(), debugPort.release()]);
            released = true;
            await session.execute(env);
            await session.waitForDebugger(request.skipBuild ? 120_000 : 300_000);
            return { id, hostPort: hostPort.port, debugPort: debugPort.port, pipe, workerPid: session.workerProcess };
        } catch (error) {
            throw await session.fail(error);
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
        await this.hosts.get(id)?.stop();
    }

    public dispose(): void {
        this.disposed = true;
        for (const id of this.hosts.keys()) {
            void this.stop(id).catch(() => {
                this.output.warn(this.code.l10n.t('[functions] Could not finish stopping an owned host.'));
            });
        }
    }
}
