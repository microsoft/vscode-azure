/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    getResourceGroupName, IContainerAppsClientProvider, type GenericResource, type IContainerAppsClient,
} from '@microsoft/vscode-azure-azutils';
import {
    CancellationError, CaselessMap, Disposable, ExternalError, IActionExecutor, IVsCode, stringifyError,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable, type ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';
import { LogStreamTerminal } from '../../../utils/logStream/LogStreamTerminal';

/** Service identifier for {@linkcode ContainerAppLogStreamService}. */
export const IContainerAppLogStreamService: ServiceIdentifier<IContainerAppLogStreamService> = Symbol.for('IContainerAppLogStreamService');
export type IContainerAppLogStreamService = ContainerAppLogStreamService;

/** App identity sufficient to stream logs without a cached tree resource. */
export type LogStreamApp = Pick<GenericResource, 'id' | 'name' | 'subscription'>;

/** Identifies one container within one replica of one container app. */
export interface LogStreamTarget {
    readonly kind?: 'console';
    readonly app: LogStreamApp;
    readonly revisionName: string;
    readonly replicaName: string;
    readonly containerName: string;
    /** Endpoint returned by ARM for the selected replica container. */
    readonly logStreamEndpoint: string;
}

/** App-wide system events do not require a running revision or replica. */
export interface SystemLogStreamTarget {
    readonly kind: 'system';
    readonly app: LogStreamApp;
}

/** A console container stream or an app-wide system event stream. */
export type ContainerAppLogStreamTarget = LogStreamTarget | SystemLogStreamTarget;

/** Redirect hops tolerated before the request is treated as a loop. */
const MaxRedirects = 5;

interface RunningStream {
    readonly terminal: vscode.Terminal;
    readonly pty: LogStreamTerminal;
}

interface Stream {
    readonly abort: AbortController;
    readonly ready: Promise<void>;
    running?: RunningStream;
}

/**
 * Opens and tracks live console and system log streams for container apps.
 *
 * The Container Apps log stream is chunked HTTP, not a web socket: an ARM call
 * exchanges the user's credentials for a short-lived data-plane token, which is
 * then presented to the container's `logStreamEndpoint` or app's
 * `eventStreamEndpoint`. Each stream writes into
 * its own pseudoterminal and is cancelled when the user closes that terminal.
 */
@injectable()
export class ContainerAppLogStreamService implements Disposable {
    private readonly streams = new CaselessMap<Stream>();
    private disposed = false;

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IContainerAppsClientProvider) private readonly createClient: IContainerAppsClientProvider,
    ) { }

    /**
     * Opens a container console stream or app-wide system stream and shows its terminal.
     *
     * Concurrent starts share initialization. Starting a stream that is already
     * open re-focuses its terminal rather than opening a second connection.
     *
     * @throws if the target exposes no log-stream endpoint, or if the
     *   endpoint rejects the request.
     * @throws {@linkcode CancellationError} if the service is disposed.
     */
    public async start(target: ContainerAppLogStreamTarget): Promise<void> {
        if (this.disposed) {
            throw new CancellationError();
        }

        const id = streamId(target);
        const existing = this.streams.get(id);
        if (existing) {
            await existing.ready;
            if (!existing.abort.signal.aborted) {
                existing.running?.terminal.show();
            }
            return;
        }

        const stream: Stream = {
            abort: new AbortController(),
            // Defer initialization until the entry is registered for concurrent starts and disposal.
            ready: Promise.resolve().then(() => this.open(id, target, stream)),
        };
        this.streams.set(id, stream);
        return stream.ready;
    }

    private async open(id: string, target: ContainerAppLogStreamTarget, stream: Stream): Promise<void> {
        try {
            await this.initialize(id, target, stream);
        } catch (error) {
            const cancelled = stream.abort.signal.aborted;
            if (this.streams.get(id) === stream) {
                this.stop(id, true);
            }
            if (cancelled && error instanceof Error && error.name === 'AbortError') {
                throw new CancellationError();
            }
            throw error;
        }
    }

    private async initialize(id: string, target: ContainerAppLogStreamTarget, stream: Stream): Promise<void> {
        const signal = stream.abort.signal;
        signal.throwIfAborted();
        const client = this.createClient(target.app.subscription);
        const resourceGroupName = getResourceGroupName(target.app.id);
        const endpoint = target.kind === 'system'
            ? await this.resolveSystemEndpoint(client, resourceGroupName, target.app, signal)
            : target.logStreamEndpoint;

        const { token } = await client.containerApps.getAuthToken(resourceGroupName, target.app.name, { abortSignal: signal });
        signal.throwIfAborted();
        if (!token) {
            throw new ExternalError(this.code.l10n.t('Could not obtain a token to stream logs for \'{0}\'.', target.app.name));
        }

        const response = await this.connect(endpoint, token, signal);
        if (signal.aborted) {
            await response.body?.cancel();
            signal.throwIfAborted();
        }

        const running = this.createTerminal(id, target, stream);
        stream.running = running;
        running.terminal.show();

        // The pump lasts until the connection ends or its terminal closes.
        void this.pump(id, response, stream, running);
    }

    private async resolveSystemEndpoint(
        client: IContainerAppsClient,
        resourceGroupName: string,
        target: LogStreamApp,
        signal: AbortSignal,
    ): Promise<string> {
        const app = await client.containerApps.get(resourceGroupName, target.name, { abortSignal: signal });
        signal.throwIfAborted();
        if (!app.eventStreamEndpoint) {
            throw new ExternalError(this.code.l10n.t('No system log stream is available for \'{0}\'.', target.name));
        }
        const url = new URL(app.eventStreamEndpoint);
        url.searchParams.set('follow', 'true');
        url.searchParams.set('output', 'json');
        return url.toString();
    }

    private createTerminal(id: string, target: ContainerAppLogStreamTarget, stream: Stream): RunningStream {
        const label = target.kind === 'system'
            ? this.code.l10n.t('{0} (system, JSON)', target.app.name)
            : this.code.l10n.t('{0} ({1})', target.replicaName, target.containerName);
        const pty = new LogStreamTerminal(() => {
            if (this.streams.get(id) === stream) {
                this.stop(id, false);
            }
        });
        const terminal = this.code.window.createTerminal({
            name: this.code.l10n.t('Logs: {0}', label),
            pty,
        });
        return { terminal, pty };
    }

    /** Stops one stream when its terminal closes. */
    private stop(id: string, disposeTerminal: boolean): void {
        const stream = this.streams.get(id);
        if (!stream) {
            return;
        }

        this.streams.delete(id);
        stream.abort.abort(new CancellationError());
        if (disposeTerminal) {
            stream.running?.terminal.dispose();
        }
    }

    /** Stops every live stream. */
    private stopAll(): void {
        for (const [id] of this.streams) {
            this.stop(id, true);
        }
    }

    /** @inheritdoc */
    public dispose(): void {
        this.disposed = true;
        this.stopAll();
    }

    /**
     * Preserves authentication across HTTPS redirects from Azure's log service;
     * automatic fetch redirects strip Authorization when the origin changes.
     */
    private async connect(endpoint: string, token: string, signal: AbortSignal): Promise<Response> {
        let url = endpoint;

        for (let hop = 0; hop <= MaxRedirects; hop++) {
            signal.throwIfAborted();
            const response = await fetch(url, {
                headers: { Authorization: `Bearer ${token}` },
                redirect: 'manual',
                signal,
            });
            if (signal.aborted) {
                await response.body?.cancel();
                signal.throwIfAborted();
            }

            if (response.status < 300 || response.status >= 400) {
                if (!response.ok) {
                    throw new Error(this.code.l10n.t('The log stream endpoint returned {0}.', response.status));
                }
                if (!response.body) {
                    throw new Error(this.code.l10n.t('The log stream endpoint returned no content.'));
                }
                return response;
            }

            const location = response.headers.get('location');
            await response.body?.cancel();
            if (!location) {
                throw new Error(this.code.l10n.t('The log stream endpoint redirected without a destination.'));
            }

            const target = new URL(location, url);
            if (target.protocol !== 'https:') {
                throw new Error(this.code.l10n.t('The log stream endpoint redirected to a non-HTTPS destination.'));
            }

            url = target.toString();
        }

        throw new Error(this.code.l10n.t('The log stream endpoint redirected too many times.'));
    }

    /** Writes decoded chunks into the stream's terminal until it ends. */
    private async pump(id: string, response: Response, stream: Stream, running: RunningStream): Promise<void> {
        const decoder = new TextDecoder();

        try {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- `connect` rejects a body-less response
            for await (const chunk of streamChunks(response.body!, stream.abort.signal)) {
                running.pty.write(decoder.decode(chunk, { stream: true }));
            }
            running.pty.write(decoder.decode());
        } catch (error) {
            // An abort is how closing the terminal ends the stream, so it is not a failure.
            if (!stream.abort.signal.aborted) {
                this.executor.output.error(`[containerApps] log stream failed: ${stringifyError(error)}`);
                running.pty.write(this.code.l10n.t('The log stream ended unexpectedly: {0}', stringifyError(error)));
            }
        } finally {
            // Only clear the entry if it is still ours; closing the terminal may have already
            // removed it and a later stream may have reused the id.
            if (this.streams.get(id) === stream) {
                this.streams.delete(id);
            }
        }
    }
}

/** Yields chunks from a web stream, ending early when `signal` aborts. */
async function* streamChunks(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncIterable<Uint8Array> {
    const reader = body.getReader();
    const onAbort = () => void reader.cancel().catch(() => { /* already closed */ });
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
        onAbort();
    }

    try {
        for (; ;) {
            const { done, value } = await reader.read();
            if (done || signal.aborted) {
                return;
            }
            yield value;
        }
    } finally {
        signal.removeEventListener('abort', onAbort);
        reader.releaseLock();
    }
}

/** Separates app-wide system streams from container/replica console streams. */
function streamId(target: ContainerAppLogStreamTarget): string {
    return target.kind === 'system'
        ? `${target.app.id}/system`
        : `${target.app.id}/console/${target.revisionName}/${target.replicaName}/${target.containerName}`;
}
