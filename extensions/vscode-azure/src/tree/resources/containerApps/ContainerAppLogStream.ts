/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getResourceGroupName, IContainerAppsClientProvider, type GenericResource } from '@microsoft/vscode-azure-azutils';
import {
    createOutputChannel, Disposable, EventEmitter, IActionExecutor, IVsCode,
    stringifyError, type IOutputChannel,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable, type ServiceIdentifier } from 'inversify';

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

/** A live log stream, as surfaced to the stop picker. */
export interface ActiveLogStream {
    readonly id: string;
    readonly label: string;
    readonly appId: string;
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
    readonly stream: ActiveLogStream;
    readonly app: GenericResource;
    readonly abort: AbortController;
    readonly channel: IOutputChannel;
}

/**
 * Opens and tracks live log streams for container app replicas.
 *
 * The Container Apps log stream is chunked HTTP, not a web socket: an ARM call
 * exchanges the user's credentials for a short-lived data-plane token, which is
 * then presented to the container's `logStreamEndpoint`. Each stream writes into
 * its own output channel and is cancelled through its own `AbortController`.
 *
 * {@linkcode onDidChangeStreams} fires whenever a stream starts or stops, so the
 * tree can re-render the affordance for stopping one.
 */
@injectable()
export class ContainerAppLogStreamService implements Disposable {
    private readonly streams = new Map<string, RunningStream>();
    private readonly changeEmitter = new EventEmitter<GenericResource>();

    /**
     * Fires with the owning container app whenever one of its streams starts or
     * stops, so a listener can re-render exactly that node.
     */
    public readonly onDidChangeStreams = this.changeEmitter.event;

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IContainerAppsClientProvider) private readonly createClient: IContainerAppsClientProvider,
    ) { }

    /** Returns `true` when at least one stream is open for the given app. */
    public isStreaming(appId: string): boolean {
        for (const { stream } of this.streams.values()) {
            if (stream.appId.toLowerCase() === appId.toLowerCase()) {
                return true;
            }
        }
        return false;
    }

    /** Returns every live stream, for the stop picker. */
    public getActiveStreams(): readonly ActiveLogStream[] {
        return [...this.streams.values()].map(running => running.stream);
    }

    /**
     * Opens a log stream for one container and shows its output channel.
     *
     * Starting a stream that is already open re-focuses its channel rather than
     * opening a second connection to the same container.
     *
     * @throws if the container exposes no log-stream endpoint, or if the
     *   endpoint rejects the request.
     */
    public async start(target: LogStreamTarget): Promise<void> {
        const id = streamId(target);
        const existing = this.streams.get(id);
        if (existing) {
            existing.channel.show();
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
        const channel = createOutputChannel(this.code.l10n.t('Logs: {0}', label), this.code);
        const abort = new AbortController();
        const running: RunningStream = {
            stream: { id, label, appId: target.app.id },
            app: target.app,
            abort,
            channel,
        };

        this.streams.set(id, running);
        channel.show();
        this.changeEmitter.fire(target.app);

        // Deliberately not awaited: the pump runs until the stream ends or is
        // cancelled, which is the lifetime of the feature, not of this call.
        void this.pump(id, response, running);
    }

    /** Stops one stream by id. Unknown ids are ignored. */
    public stop(id: string): void {
        const running = this.streams.get(id);
        if (!running) {
            return;
        }

        this.streams.delete(id);
        running.abort.abort();
        running.channel.dispose();
        this.changeEmitter.fire(running.app);
    }

    /** Stops every live stream. */
    public stopAll(): void {
        for (const id of [...this.streams.keys()]) {
            this.stop(id);
        }
    }

    /** @inheritdoc */
    public dispose(): void {
        this.stopAll();
        this.changeEmitter.dispose();
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

    /** Writes decoded chunks into the stream's channel until it ends. */
    private async pump(id: string, response: Response, running: RunningStream): Promise<void> {
        const decoder = new TextDecoder();

        try {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- `connect` rejects a body-less response
            for await (const chunk of streamChunks(response.body!, running.abort.signal)) {
                for (const line of decoder.decode(chunk, { stream: true }).split(/\r?\n/)) {
                    if (line) {
                        running.channel.appendLine(line);
                    }
                }
            }
        } catch (error) {
            // An abort is how `stop` ends the stream, so it is not a failure.
            if (!running.abort.signal.aborted) {
                this.executor.output.error(`[containerApps] log stream failed: ${stringifyError(error)}`);
                running.channel.appendLine(this.code.l10n.t('The log stream ended unexpectedly: {0}', stringifyError(error)));
            }
        } finally {
            // Only clear the entry if it is still ours; `stop` may have already
            // removed it and a later stream may have reused the id.
            if (this.streams.get(id) === running) {
                this.streams.delete(id);
                this.changeEmitter.fire(running.app);
            }
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
