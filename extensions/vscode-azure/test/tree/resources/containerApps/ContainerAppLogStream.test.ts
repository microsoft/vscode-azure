/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureChinaCloud, AzurePublicCloud, AzureUSGovernment, type ContainerAppAuthToken, type GenericResource, type Replica } from '@microsoft/vscode-azure-azutils';
import { createMockContainerAppsClient, makeContainerApp, makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import { CancellationError } from '@microsoft/vscode-azure-utils';
import { createMockVsCode, createTestActionExecutor, waitFor } from '@microsoft/vscode-azure-utils/testing';
import { mock, type Mock } from 'node:test';
import type * as vscode from 'vscode';
import { ContainerAppLogStreamService, type LogStreamTarget } from '../../../../src/tree/resources/containerApps/ContainerAppLogStream';

const LogStreamEndpoint = 'https://myapp.eastus.azurecontainerapps.io/logstream';
const Clouds = [
    { environment: AzurePublicCloud, suffix: 'azurecontainerapps.io' },
    { environment: AzureUSGovernment, suffix: 'azurecontainerapps.us' },
    { environment: AzureChinaCloud, suffix: 'azurecontainerapps.cn' },
];

interface TestTerminal {
    readonly name: string;
    readonly pty: vscode.Pseudoterminal;
    readonly writes: string[];
    readonly show: Mock<() => void>;
    readonly dispose: Mock<() => void>;
}

function makeTarget(app: GenericResource): LogStreamTarget {
    return { app, revisionName: 'rev1', replicaName: 'replica1', containerName: 'api' };
}

/** A client whose replica exposes a log-stream endpoint for container `api`. */
function createClient(logStreamEndpoint: string | undefined) {
    return createMockContainerAppsClient({
        replicas: [{
            name: 'replica1',
            containers: [{ name: 'api', logStreamEndpoint }],
        }],
    });
}

/** The common case: a replica whose container streams from the usual endpoint. */
function createStreamingClient() {
    return createClient(LogStreamEndpoint);
}

/** Builds a service with test terminals that expose their pseudoterminal lifecycle. */
function createService(client: ReturnType<typeof createClient>) {
    const terminals: TestTerminal[] = [];
    const createTerminal = mock.fn((options: vscode.ExtensionTerminalOptions): vscode.Terminal => {
        const writes: string[] = [];
        options.pty.onDidWrite(value => {
            writes.push(value);
        });

        const terminal: TestTerminal = {
            name: options.name,
            pty: options.pty,
            writes,
            show: mock.fn(),
            dispose: mock.fn(() => {
                options.pty.close();
            }),
        };
        terminals.push(terminal);
        return terminal as unknown as vscode.Terminal;
    });
    const { vscode: code } = createMockVsCode({
        window: { createTerminal } as unknown as typeof vscode.window,
    });
    const { executor } = createTestActionExecutor();
    return {
        service: new ContainerAppLogStreamService(code, executor, () => client),
        terminals,
    };
}

/** A never-ending body, so a started stream stays open for the assertions. */
function openBody(onCancel?: () => void): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new TextEncoder().encode('hello\n'));
        },
        cancel: onCancel,
    });
}

describe('ContainerAppLogStreamService (unit)', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    it('writes streamed chunks to a named terminal', async () => {
        mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(openBody(), { status: 200 })));
        const app = makeContainerApp();
        const { service, terminals } = createService(createStreamingClient());

        await service.start(makeTarget(app));
        await waitFor(() => terminals[0].writes.length > 0);

        expect(terminals).to.have.lengthOf(1);
        expect(terminals[0].name).to.equal('Logs: replica1 (api)');
        expect(terminals[0].writes).to.deep.equal(['hello\r\n']);
        expect(terminals[0].show.mock.callCount()).to.equal(1);

        service.dispose();
    });

    it('reuses the existing terminal when the same container is started twice', async () => {
        const fetchMock = mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(openBody(), { status: 200 })));
        const app = makeContainerApp();
        const { service, terminals } = createService(createStreamingClient());

        await service.start(makeTarget(app));
        await service.start(makeTarget(app));

        expect(terminals).to.have.lengthOf(1);
        expect(terminals[0].show.mock.callCount()).to.equal(2);
        expect(fetchMock.mock.callCount()).to.equal(1);

        service.dispose();
    });

    it('shares initialization across concurrent starts at every network boundary', async () => {
        const replicas = Promise.withResolvers<readonly Replica[]>();
        const auth = Promise.withResolvers<ContainerAppAuthToken>();
        const response = Promise.withResolvers<Response>();
        const client = createStreamingClient();
        client.containerAppsRevisionReplicas.listReplicas.mock.mockImplementation(() => replicas.promise);
        client.containerApps.getAuthToken.mock.mockImplementation(() => auth.promise);
        const fetchMock = mock.method(globalThis, 'fetch', () => response.promise);
        const target = makeTarget(makeContainerApp());
        const { service, terminals } = createService(client);

        const starts = [service.start(target), service.start(target)];
        replicas.resolve([{ name: target.replicaName, containers: [{ name: target.containerName, logStreamEndpoint: LogStreamEndpoint }] }]);
        await waitFor(() => client.containerApps.getAuthToken.mock.callCount() > 0);
        starts.push(service.start(target));
        auth.resolve({ token: 'test-token', location: 'eastus' });
        await waitFor(() => fetchMock.mock.callCount() > 0);
        starts.push(service.start({ ...target, app: makeContainerApp({ id: target.app.id.toUpperCase() }) }));
        response.resolve(new Response(openBody(), { status: 200 }));
        await Promise.all(starts);

        expect(client.containerAppsRevisionReplicas.listReplicas.mock.callCount()).to.equal(1);
        expect(client.containerApps.getAuthToken.mock.callCount()).to.equal(1);
        expect(fetchMock.mock.callCount()).to.equal(1);
        expect(terminals).to.have.lengthOf(1);
        expect(terminals[0].show.mock.callCount()).to.equal(starts.length);

        service.dispose();
    });

    for (const operation of ['listReplicas', 'getAuthToken'] as const) {
        it(`cancels initialization while ${operation} is pending`, async () => {
            const replicas = Promise.withResolvers<readonly Replica[]>();
            const auth = Promise.withResolvers<ContainerAppAuthToken>();
            const client = createStreamingClient();
            if (operation === 'listReplicas') {
                client.containerAppsRevisionReplicas.listReplicas.mock.mockImplementation(() => replicas.promise);
            } else {
                client.containerApps.getAuthToken.mock.mockImplementation(() => auth.promise);
            }
            const pendingOperation = operation === 'listReplicas'
                ? client.containerAppsRevisionReplicas.listReplicas.mock
                : client.containerApps.getAuthToken.mock;
            const fetchMock = mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(null, { status: 403 })));
            const { service, terminals } = createService(client);
            const started = expect(service.start(makeTarget(makeContainerApp()))).to.be.rejectedWith(CancellationError);
            await waitFor(() => pendingOperation.callCount() > 0);
            const args = pendingOperation.calls[0].arguments;
            const options = args[args.length - 1] as { abortSignal: AbortSignal };

            service.dispose();
            expect(options.abortSignal.aborted).to.be.true;
            replicas.resolve([]);
            auth.resolve({ token: 'test-token', location: 'eastus' });
            await started;

            expect(terminals).to.be.empty;
            expect(fetchMock.mock.callCount()).to.equal(0);
            if (operation === 'listReplicas') {
                expect(client.containerApps.getAuthToken.mock.callCount()).to.equal(0);
            }
        });

        it(`allows a retry after ${operation} fails`, async () => {
            const client = createStreamingClient();
            const failure = new Error('ARM request failed');
            if (operation === 'listReplicas') {
                client.containerAppsRevisionReplicas.listReplicas.mock.mockImplementationOnce(() => Promise.reject(failure));
            } else {
                client.containerApps.getAuthToken.mock.mockImplementationOnce(() => Promise.reject(failure));
            }
            const fetchMock = mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(openBody(), { status: 200 })));
            const { service, terminals } = createService(client);
            const target = makeTarget(makeContainerApp());

            await expect(service.start(target)).to.be.rejectedWith(failure);
            await service.start(target);

            expect(terminals).to.have.lengthOf(1);
            expect(fetchMock.mock.callCount()).to.equal(1);
            service.dispose();
        });
    }

    for (const aborted of [true, false]) {
        it(`${aborted ? 'reports cancellation' : 'preserves the original failure'} when a disposed request rejects`, async () => {
            const response = Promise.withResolvers<Response>();
            const fetchMock = mock.method(globalThis, 'fetch', () => response.promise);
            const failure = aborted ? new DOMException('Aborted', 'AbortError') : new Error('Connection failed');
            const { service, terminals } = createService(createStreamingClient());
            const started = expect(service.start(makeTarget(makeContainerApp()))).to.be.rejectedWith(aborted ? CancellationError : failure);
            await waitFor(() => fetchMock.mock.callCount() > 0);

            service.dispose();
            response.reject(failure);
            await started;

            expect(terminals).to.be.empty;
        });
    }

    it('aborts a pending fetch and cancels a response that arrives after disposal', async () => {
        const response = Promise.withResolvers<Response>();
        const fetchMock = mock.method(globalThis, 'fetch', () => response.promise);
        const cancel = mock.fn();
        const { service, terminals } = createService(createStreamingClient());
        const started = expect(service.start(makeTarget(makeContainerApp()))).to.be.rejectedWith(CancellationError);
        await waitFor(() => fetchMock.mock.callCount() > 0);
        const signal = fetchMock.mock.calls[0].arguments[1]?.signal;

        service.dispose();
        expect(signal?.aborted).to.be.true;
        response.resolve(new Response(openBody(cancel), { status: 200 }));
        await started;

        expect(cancel.mock.callCount()).to.equal(1);
        expect(terminals).to.be.empty;
    });

    it('does not follow a redirect received after disposal', async () => {
        const response = Promise.withResolvers<Response>();
        const fetchMock = mock.method(globalThis, 'fetch', () => response.promise);
        const { service, terminals } = createService(createStreamingClient());
        const started = expect(service.start(makeTarget(makeContainerApp()))).to.be.rejectedWith(CancellationError);
        await waitFor(() => fetchMock.mock.callCount() > 0);

        service.dispose();
        response.resolve(new Response(null, { status: 302, headers: { location: LogStreamEndpoint } }));
        await started;

        expect(fetchMock.mock.callCount()).to.equal(1);
        expect(terminals).to.be.empty;
    });

    it('rejects starts after the service is disposed without making requests', async () => {
        const client = createStreamingClient();
        const { service, terminals } = createService(client);
        service.dispose();

        await expect(service.start(makeTarget(makeContainerApp()))).to.be.rejectedWith(CancellationError);

        expect(client.containerAppsRevisionReplicas.listReplicas.mock.callCount()).to.equal(0);
        expect(terminals).to.be.empty;
    });

    it('propagates initialization failures to all callers and allows a retry', async () => {
        const response = Promise.withResolvers<Response>();
        const fetchMock = mock.method(globalThis, 'fetch', () => response.promise);
        const failure = new Error('Connection failed');
        const { service, terminals } = createService(createStreamingClient());
        const target = makeTarget(makeContainerApp());
        const starts = [service.start(target), service.start(target)];
        const failed = Promise.all(starts.map(start => expect(start).to.be.rejectedWith(failure)));
        await waitFor(() => fetchMock.mock.callCount() > 0);

        response.reject(failure);
        await failed;
        expect(terminals).to.be.empty;

        fetchMock.mock.mockImplementation(() => Promise.resolve(new Response(openBody(), { status: 200 })));
        await service.start(target);
        expect(terminals).to.have.lengthOf(1);
        expect(fetchMock.mock.callCount()).to.equal(2);

        service.dispose();
    });

    it('cancels the stream when its terminal closes', async () => {
        const cancel = mock.fn();
        const fetchMock = mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(openBody(cancel), { status: 200 })));
        const app = makeContainerApp();
        const { service, terminals } = createService(createStreamingClient());
        await service.start(makeTarget(app));

        terminals[0].pty.close();
        await waitFor(() => cancel.mock.callCount() > 0);
        expect(fetchMock.mock.calls[0].arguments[1]?.signal?.aborted).to.be.true;

        await service.start(makeTarget(app));
        expect(terminals).to.have.lengthOf(2);

        service.dispose();
    });

    for (const { environment, suffix } of Clouds) {
        it(`follows a redirect within ${environment.name}`, async () => {
            const endpoint = `https://myapp.region.${suffix}/logstream`;
            const destination = `https://other.region.${suffix}/logstream`;
            const fetchMock = mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(openBody(), { status: 200 })));
            fetchMock.mock.mockImplementationOnce(() => Promise.resolve(
                new Response(null, { status: 302, headers: { location: destination } }),
            ));
            const { service } = createService(createClient(endpoint));

            await service.start(makeTarget(makeContainerApp({ subscription: makeSubscription({ environment }) })));

            expect(fetchMock.mock.calls.map(call => call.arguments[0])).to.deep.equal([endpoint, destination]);
            const requests = fetchMock.mock.calls.map(call => call.arguments[1]);
            expect(requests[0]?.headers).to.deep.equal(requests[1]?.headers);
            expect(requests.every(request => request?.redirect === 'manual')).to.be.true;
            expect(requests[0]?.signal).to.equal(requests[1]?.signal);

            service.dispose();
        });

        for (const otherCloud of Clouds.filter(cloud => cloud.environment !== environment)) {
            it(`rejects a redirect from ${environment.name} to ${otherCloud.environment.name}`, async () => {
                const fetchMock = mock.method(globalThis, 'fetch', () => Promise.resolve(
                    new Response(null, { status: 302, headers: { location: `https://other.region.${otherCloud.suffix}/logstream` } }),
                ));
                const { service, terminals } = createService(createClient(`https://myapp.region.${suffix}/logstream`));
                const app = makeContainerApp({ subscription: makeSubscription({ environment }) });

                await expect(service.start(makeTarget(app))).to.be.rejectedWith(/redirected outside/i);
                expect(fetchMock.mock.callCount()).to.equal(1);
                expect(terminals).to.be.empty;
            });
        }
    }

    it('refuses to send the token to a host outside the Container Apps data plane', async () => {
        mock.method(globalThis, 'fetch', () => Promise.resolve(
            new Response(null, { status: 302, headers: { location: 'https://evil.example.com/steal' } }),
        ));
        const { service, terminals } = createService(createStreamingClient());

        await expect(service.start(makeTarget(makeContainerApp()))).to.be.rejectedWith(/redirected outside/i);
        expect(terminals).to.be.empty;
    });

    it('refuses a plain-http redirect', async () => {
        mock.method(globalThis, 'fetch', () => Promise.resolve(
            new Response(null, { status: 302, headers: { location: 'http://myapp.eastus.azurecontainerapps.io/logstream' } }),
        ));
        const { service } = createService(createStreamingClient());

        await expect(service.start(makeTarget(makeContainerApp()))).to.be.rejectedWith(/redirected outside/i);
    });

    for (const hostname of ['evilazurecontainerapps.io', 'azurecontainerapps.io.evil.example', 'azurecontainerapps.io']) {
        it(`rejects the lookalike host ${hostname}`, async () => {
            const fetchMock = mock.method(globalThis, 'fetch', () => Promise.resolve(
                new Response(null, { status: 302, headers: { location: `https://${hostname}/logstream` } }),
            ));
            const { service } = createService(createStreamingClient());

            await expect(service.start(makeTarget(makeContainerApp()))).to.be.rejectedWith(/redirected outside/i);
            expect(fetchMock.mock.callCount()).to.equal(1);
        });
    }

    it('rejects redirects for an unrecognized custom cloud', async () => {
        const fetchMock = mock.method(globalThis, 'fetch', () => Promise.resolve(
            new Response(null, { status: 302, headers: { location: LogStreamEndpoint } }),
        ));
        const { service } = createService(createStreamingClient());
        const environment = { ...AzurePublicCloud, isCustomCloud: true, resourceManagerEndpointUrl: 'https://management.example.com' };
        const app = makeContainerApp({ subscription: makeSubscription({ environment }) });

        await expect(service.start(makeTarget(app))).to.be.rejectedWith(/redirected outside/i);
        expect(fetchMock.mock.callCount()).to.equal(1);
    });

    it('reports a container that exposes no endpoint', async () => {
        const { service } = createService(createClient(undefined));

        await expect(service.start(makeTarget(makeContainerApp()))).to.be.rejectedWith(/No log stream is available/i);
    });

    it('surfaces a rejection from the endpoint', async () => {
        mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(null, { status: 403 })));
        const { service } = createService(createStreamingClient());

        await expect(service.start(makeTarget(makeContainerApp()))).to.be.rejectedWith(/returned 403/i);
    });

    it('closes every terminal on dispose', async () => {
        mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(openBody(), { status: 200 })));
        const app = makeContainerApp();
        const { service, terminals } = createService(createStreamingClient());
        await service.start(makeTarget(app));

        service.dispose();

        expect(terminals[0].dispose.mock.callCount()).to.equal(1);
    });
});
