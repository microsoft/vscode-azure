/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getResourceGroupName, IContainerAppsClientProvider, type GenericResource } from '@microsoft/vscode-azure-azutils';
import {
    Disposable, EventEmitter, IActionExecutor, IVsCode, stringifyError,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable, type ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';

/** Service identifier for {@linkcode ContainerAppLogStreamService}. */
export const IContainerAppLogStreamService: ServiceIdentifier<IContainerAppLogStreamService> = Symbol.for('IContainerAppLogStreamService');
export type IContainerAppLogStreamService = ContainerAppLogStreamService;

/** Identifies one container within one replica of one container app. */
export interface LogStreamTarget {
    readonly app: GenericResource;
    readonly revisionName: string;
    readonly replicaName: string;
    readonly containerName: string;
}

/**
 * Hosts on which a data-plane token may be presented.
 *
 * The log-stream endpoint issues a redirect to a regional host, and the token
 * has to survive it. Following redirects blindly would hand an Azure
 * credential to whatever host the response names, so the token is only
 * re-attached while the target stays inside the Container Apps data plane.
 */
const LogStreamHostSuffix = '.azurecontainerapps.io';

/** Redirect hops tolerated before the request is treated as a loop. */
const MaxRedirects = 5;

interface RunningStream {
    readonly abort: AbortController;
    readonly terminal: vscode.Terminal;
    readonly pty: LogStreamPseudoterminal;
}

/**
 * Opens and tracks live log streams for container app replicas.
 *
 * The Container Apps log stream is chunked HTTP, not a web socket: an ARM call
 * exchanges the user's credentials for a short-lived data-plane token, which is
 * then presented to the container's `logStreamEndpoint`. Each stream writes into
 * its own pseudoterminal and is cancelled when the user closes that terminal.
 */
@injectable()
export class ContainerAppLogStreamService implements Disposable {
    private readonly streams = new Map<string, RunningStream>();

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IContainerAppsClientProvider) private readonly createClient: IContainerAppsClientProvider,
    ) { }

    /**
     * Opens a log stream for one container and shows its terminal.
     *
     * Starting a stream that is already open re-focuses its terminal rather than
     * opening a second connection to the same container.
     *
     * @throws if the container exposes no log-stream endpoint, or if the
     *   endpoint rejects the request.
     */
    public async start(target: LogStreamTarget): Promise<void> {
        const id = streamId(target);
        const existing = this.streams.get(id);
        if (existing) {
            existing.terminal.show();
            return;
        }

        const client = this.createClient(target.app.subscription);
        const resourceGroupName = getResourceGroupName(target.app.id);

        const replicas = await client.containerAppsRevisionReplicas.listReplicas(
            resourceGroupName,
            target.app.name,
            target.revisionName,
        );

        const container = replicas
            .find(replica => replica.name === target.replicaName)
            ?.containers?.find(c => c.name === target.containerName);

        const endpoint = container?.logStreamEndpoint;
        if (!endpoint) {
            throw new Error(this.code.l10n.t(
                'No log stream is available for container \'{0}\'. It may not be running yet.',
                target.containerName,
            ));
        }

        const { token } = await client.containerApps.getAuthToken(resourceGroupName, target.app.name);
        if (!token) {
            throw new Error(this.code.l10n.t('Could not obtain a token to stream logs for \'{0}\'.', target.app.name));
        }

        const response = await this.connect(endpoint, token);

        const label = this.code.l10n.t('{0} ({1})', target.replicaName, target.containerName);
        const abort = new AbortController();
        const pty = new LogStreamPseudoterminal(() => {
            this.stop(id, false);
        });
        const terminal = this.code.window.createTerminal({
            name: this.code.l10n.t('Logs: {0}', label),
            pty,
        });
        const running: RunningStream = {
            abort,
            terminal,
            pty,
        };

        this.streams.set(id, running);
        terminal.show();

        // Deliberately not awaited: the pump runs until the stream ends or is
        // cancelled, which is the lifetime of the feature, not of this call.
        void this.pump(id, response, running);
    }

    /** Stops one stream when its terminal closes. */
    private stop(id: string, disposeTerminal: boolean): void {
        const running = this.streams.get(id);
        if (!running) {
            return;
        }

        this.streams.delete(id);
        running.abort.abort();
        if (disposeTerminal) {
            running.terminal.dispose();
        }
    }

    /** Stops every live stream. */
    private stopAll(): void {
        for (const id of [...this.streams.keys()]) {
            this.stop(id, true);
        }
    }

    /** @inheritdoc */
    public dispose(): void {
        this.stopAll();
    }

    /**
     * Issues the streaming request, following redirects by hand so the
     * data-plane token is only ever re-sent to a Container Apps host.
     */
    private async connect(endpoint: string, token: string): Promise<Response> {
        let url = endpoint;

        for (let hop = 0; hop <= MaxRedirects; hop++) {
            const response = await fetch(url, {
                headers: { Authorization: `Bearer ${token}` },
                redirect: 'manual',
            });

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
            if (!location) {
                throw new Error(this.code.l10n.t('The log stream endpoint redirected without a destination.'));
            }

            const target = new URL(location, url);
            if (target.protocol !== 'https:' || !target.hostname.toLowerCase().endsWith(LogStreamHostSuffix)) {
                throw new Error(this.code.l10n.t('The log stream endpoint redirected outside Azure Container Apps.'));
            }

            url = target.toString();
        }

        throw new Error(this.code.l10n.t('The log stream endpoint redirected too many times.'));
    }

    /** Writes decoded chunks into the stream's terminal until it ends. */
    private async pump(id: string, response: Response, running: RunningStream): Promise<void> {
        const decoder = new TextDecoder();

        try {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- `connect` rejects a body-less response
            for await (const chunk of streamChunks(response.body!, running.abort.signal)) {
                running.pty.write(decoder.decode(chunk, { stream: true }));
            }
            running.pty.write(decoder.decode());
        } catch (error) {
            // An abort is how closing the terminal ends the stream, so it is not a failure.
            if (!running.abort.signal.aborted) {
                this.executor.output.error(`[containerApps] log stream failed: ${stringifyError(error)}`);
                running.pty.write(this.code.l10n.t('The log stream ended unexpectedly: {0}', stringifyError(error)));
            }
        } finally {
            // Only clear the entry if it is still ours; closing the terminal may have already
            // removed it and a later stream may have reused the id.
            if (this.streams.get(id) === running) {
                this.streams.delete(id);
            }
        }
    }
}

/** Writable terminal endpoint whose closure cancels its associated stream. */
class LogStreamPseudoterminal implements vscode.Pseudoterminal {
    private readonly writeEmitter = new EventEmitter<string>();
    private closed = false;

    public readonly onDidWrite = this.writeEmitter.event;

    public constructor(private readonly onClose: () => void) { }

    public open(): void { /* The stream starts before VS Code opens its terminal. */ }

    public close(): void {
        if (this.closed) {
            return;
        }

        this.closed = true;
        this.onClose();
        this.writeEmitter.dispose();
    }

    /** Writes stream text using the CRLF line endings expected by terminals. */
    public write(value: string): void {
        if (!this.closed && value) {
            this.writeEmitter.fire(value.replace(/\r?\n/g, '\r\n'));
        }
    }
}

/** Yields chunks from a web stream, ending early when `signal` aborts. */
async function* streamChunks(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncIterable<Uint8Array> {
    const reader = body.getReader();
    const onAbort = () => void reader.cancel().catch(() => { /* already closed */ });
    signal.addEventListener('abort', onAbort, { once: true });

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

/** Builds the stable identity of a stream: one per container per replica. */
function streamId(target: LogStreamTarget): string {
    return `${target.app.id}/${target.revisionName}/${target.replicaName}/${target.containerName}`.toLowerCase();
}
