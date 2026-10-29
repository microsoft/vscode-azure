/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureChinaCloud, AzurePublicCloud, AzureUSGovernment, type ContainerApp, type ContainerAppAuthToken, type GenericResource } from '@microsoft/vscode-azure-azutils';
import { createMockContainerAppsClient, makeContainerApp, makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import { CancellationError, ExternalError } from '@microsoft/vscode-azure-utils';
import { createMockVsCode, createTestActionExecutor, waitFor } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { ContainerAppLogStreamService, type LogStreamTarget } from '../../../../src/tree/resources/containerApps/ContainerAppLogStream';

const LogStreamEndpoint = 'https://myapp.eastus.azurecontainerapps.io/logstream';
const EventStreamEndpoint = 'https://eastus.azurecontainerapps.dev/subscriptions/sub/resourceGroups/rg/containerApps/app/eventstream';
const Clouds = [
    { environment: AzurePublicCloud, suffix: 'azurecontainerapps.io' },
    { environment: AzureUSGovernment, suffix: 'azurecontainerapps.us' },
    { environment: AzureChinaCloud, suffix: 'azurecontainerapps.cn' },
];

function makeTarget(app: GenericResource, logStreamEndpoint = LogStreamEndpoint): LogStreamTarget {
    return { app, revisionName: 'rev1', replicaName: 'replica1', containerName: 'api', logStreamEndpoint };
}

/** Builds a service with test terminals that expose their pseudoterminal lifecycle. */
function createService(client = createMockContainerAppsClient(), openOnShow = true) {
    const { vscode: code, terminals } = createMockVsCode(undefined, { openTerminalsOnShow: openOnShow });
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
    for (const missing of ['endpoint', 'token']) {
        it(`suppresses issue reporting for an unavailable system log ${missing}`, async () => {
            const client = createMockContainerAppsClient(
                missing === 'token' ? { eventStreamEndpoint: EventStreamEndpoint } : {},
            );
            if (missing === 'token') {
                client.containerApps.getAuthToken.mock.mockImplementation(() => Promise.resolve({ location: 'eastus' }));
            }
            const { service } = createService(client);
            await expect(service.start({ kind: 'system', app: makeContainerApp() }))
                .to.be.rejectedWith(ExternalError, missing === 'endpoint' ? 'No system log stream' : 'Could not obtain a token');
            service.dispose();
        });
    }

    afterEach(() => {
        mock.restoreAll();
    });

    it('writes streamed chunks to a named terminal', async () => {
        mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(openBody(), { status: 200 })));
        const app = makeContainerApp();
        const { service, terminals } = createService();

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
        const { service, terminals } = createService();

        await service.start(makeTarget(app));
        await service.start(makeTarget(app));

        expect(terminals).to.have.lengthOf(1);
        expect(terminals[0].show.mock.callCount()).to.equal(2);
        expect(fetchMock.mock.callCount()).to.equal(1);

        service.dispose();
    });

    it('retains initial output until VS Code opens the pseudoterminal', async () => {
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('startup log\n'));
                controller.close();
            },
        });
        mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(body)));
        const { service, terminals } = createService(createMockContainerAppsClient(), false);

        await service.start(makeTarget(makeContainerApp()));
        await waitFor(() => !body.locked);
        expect(terminals[0].writes).to.be.empty;

        terminals[0].pty.open(undefined);
        expect(terminals[0].writes.join('')).to.equal('startup log\r\n');
        terminals[0].pty.close();
        service.dispose();
    });

    it('preserves UTF-8 characters and CRLF across network chunk boundaries', async () => {
        const bytes = new TextEncoder().encode('first\r\n\u20ac\n');
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(bytes.slice(0, 6));
                controller.enqueue(bytes.slice(6, 8));
                controller.enqueue(bytes.slice(8));
                controller.close();
            },
        });
        mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(body)));
        const { service, terminals } = createService();

        await service.start(makeTarget(makeContainerApp()));
        await waitFor(() => !body.locked);

        expect(terminals[0].writes.join('')).to.equal('first\r\n\u20ac\r\n');
        terminals[0].pty.close();
        service.dispose();
    });

    it('streams app-wide JSON events and independently reuses console and system terminals', async () => {
        const cancel = mock.fn();
        const fetchMock = mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(openBody(cancel))));
        const client = createMockContainerAppsClient();
        const app = makeContainerApp();
        const details = await client.containerApps.get('rg', app.name);
        client.containerApps.get.mock.resetCalls();
        client.containerApps.get.mock.mockImplementation(() => Promise.resolve({ ...details, eventStreamEndpoint: `${EventStreamEndpoint}?api-version=2025-01-01` }));
        const { service, terminals } = createService(client);
        const system = { kind: 'system' as const, app };

        await Promise.all([service.start(system), service.start(system)]);

        expect(client.containerApps.get.mock.callCount()).to.equal(1);
        expect(client.containerAppsRevisionReplicas.listReplicas.mock.callCount()).to.equal(0);
        expect(client.containerApps.getAuthToken.mock.callCount()).to.equal(1);
        const url = new URL(fetchMock.mock.calls[0].arguments[0] as string);
        expect(url.origin + url.pathname).to.equal(EventStreamEndpoint);
        expect(Object.fromEntries(url.searchParams)).to.deep.equal({ 'api-version': '2025-01-01', follow: 'true', output: 'json' });
        expect(fetchMock.mock.calls[0].arguments[1]?.headers).to.have.property('Authorization', 'Bearer test-token');
        expect(terminals[0].name).to.include(app.name).and.include('system, JSON');

        await service.start(makeTarget(app));
        await service.start({ kind: 'system', app: { ...app, id: app.id.toUpperCase() } });
        await service.start(makeTarget(app));
        expect(terminals).to.have.length(2);
        expect(fetchMock.mock.callCount()).to.equal(2);
        expect(terminals[0].show.mock.callCount()).to.equal(3);
        expect(terminals[1].show.mock.callCount()).to.equal(2);
        terminals[0].pty.close();
        await waitFor(() => cancel.mock.callCount() > 0);
        expect(fetchMock.mock.calls[0].arguments[1]?.signal?.aborted).to.be.true;
        expect(fetchMock.mock.calls[1].arguments[1]?.signal?.aborted).to.be.false;
        service.dispose();
    });

    it('reports a missing system endpoint and allows retry after the app exposes it', async () => {
        const client = createMockContainerAppsClient();
        const { service, terminals } = createService(client);
        const target = { kind: 'system' as const, app: makeContainerApp() };
        await expect(service.start(target)).to.be.rejectedWith('No system log stream');
        expect(client.containerApps.getAuthToken.mock.callCount()).to.equal(0);
        expect(terminals).to.be.empty;
        const ready = createMockContainerAppsClient({ eventStreamEndpoint: EventStreamEndpoint });
        client.containerApps.get.mock.mockImplementation((...args) => ready.containerApps.get(...args));
        mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(openBody())));
        await service.start(target);
        expect(terminals).to.have.length(1);
        service.dispose();
    });

    it('cancels system initialization while the app endpoint lookup is pending', async () => {
        const app = Promise.withResolvers<ContainerApp>();
        const client = createMockContainerAppsClient();
        client.containerApps.get.mock.mockImplementation(() => app.promise);
        const { service, terminals } = createService(client);
        const started = expect(service.start({ kind: 'system', app: makeContainerApp() })).to.be.rejectedWith(CancellationError);
        await waitFor(() => client.containerApps.get.mock.callCount() > 0);
        service.dispose();
        expect(client.containerApps.get.mock.calls[0].arguments[2]?.abortSignal?.aborted).to.be.true;
        app.resolve(await createMockContainerAppsClient({ eventStreamEndpoint: EventStreamEndpoint }).containerApps.get('rg', 'app'));
        await started;
        expect(client.containerApps.getAuthToken.mock.callCount()).to.equal(0);
        expect(terminals).to.be.empty;
    });

    it('preserves authentication when the system endpoint redirects to a regional host', async () => {
        const destination = 'https://region.azurecontainerapps.dev/eventstream';
        const fetchMock = mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(openBody())));
        fetchMock.mock.mockImplementationOnce(() => Promise.resolve(new Response(null, { status: 302, headers: { location: destination } })));
        const { service } = createService(createMockContainerAppsClient({ eventStreamEndpoint: EventStreamEndpoint }));

        await service.start({ kind: 'system', app: makeContainerApp() });

        expect(fetchMock.mock.calls[1].arguments[0]).to.equal(destination);
        expect(fetchMock.mock.calls[1].arguments[1]?.headers).to.deep.equal(fetchMock.mock.calls[0].arguments[1]?.headers);
        service.dispose();
    });

    it('shares initialization across concurrent starts at every network boundary', async () => {
        const auth = Promise.withResolvers<ContainerAppAuthToken>();
        const response = Promise.withResolvers<Response>();
        const client = createMockContainerAppsClient();
        client.containerApps.getAuthToken.mock.mockImplementation(() => auth.promise);
        const fetchMock = mock.method(globalThis, 'fetch', () => response.promise);
        const target = makeTarget(makeContainerApp());
        const { service, terminals } = createService(client);

        const starts = [service.start(target), service.start(target)];
        await waitFor(() => client.containerApps.getAuthToken.mock.callCount() > 0);
        starts.push(service.start(target));
        auth.resolve({ token: 'test-token', location: 'eastus' });
        await waitFor(() => fetchMock.mock.callCount() > 0);
        starts.push(service.start({ ...target, app: makeContainerApp({ id: target.app.id.toUpperCase() }) }));
        response.resolve(new Response(openBody(), { status: 200 }));
        await Promise.all(starts);

        expect(client.containerApps.getAuthToken.mock.callCount()).to.equal(1);
        expect(fetchMock.mock.callCount()).to.equal(1);
        expect(terminals).to.have.lengthOf(1);
        expect(terminals[0].show.mock.callCount()).to.equal(starts.length);

        service.dispose();
    });

    it('cancels initialization while token acquisition is pending', async () => {
        const auth = Promise.withResolvers<ContainerAppAuthToken>();
        const client = createMockContainerAppsClient();
        client.containerApps.getAuthToken.mock.mockImplementation(() => auth.promise);
        const pendingOperation = client.containerApps.getAuthToken.mock;
        const fetchMock = mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(null, { status: 403 })));
        const { service, terminals } = createService(client);
        const started = expect(service.start(makeTarget(makeContainerApp()))).to.be.rejectedWith(CancellationError);
        await waitFor(() => pendingOperation.callCount() > 0);
        const options = pendingOperation.calls[0].arguments[2];

        service.dispose();
        expect(options?.abortSignal?.aborted).to.be.true;
        auth.resolve({ token: 'test-token', location: 'eastus' });
        await started;

        expect(terminals).to.be.empty;
        expect(fetchMock.mock.callCount()).to.equal(0);
    });

    it('allows a retry after token acquisition fails', async () => {
        const client = createMockContainerAppsClient();
        const failure = new Error('ARM request failed');
        client.containerApps.getAuthToken.mock.mockImplementationOnce(() => Promise.reject(failure));
        const fetchMock = mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(openBody(), { status: 200 })));
        const { service, terminals } = createService(client);
        const target = makeTarget(makeContainerApp());

        await expect(service.start(target)).to.be.rejectedWith(failure);
        await service.start(target);

        expect(terminals).to.have.lengthOf(1);
        expect(fetchMock.mock.callCount()).to.equal(1);
        service.dispose();
    });

    it('cancels concurrent starts when disposed before initialization runs', async () => {
        const client = createMockContainerAppsClient();
        const { service, terminals } = createService(client);
        const target = makeTarget(makeContainerApp());
        const starts = [service.start(target), service.start(target)];

        service.dispose();

        await Promise.all(starts.map(start => expect(start).to.be.rejectedWith(CancellationError)));
        expect(client.containerApps.getAuthToken.mock.callCount()).to.equal(0);
        expect(terminals).to.be.empty;
    });

    for (const aborted of [true, false]) {
        it(`${aborted ? 'reports cancellation' : 'preserves the original failure'} when a disposed request rejects`, async () => {
            const response = Promise.withResolvers<Response>();
            const fetchMock = mock.method(globalThis, 'fetch', () => response.promise);
            const failure = aborted ? new DOMException('Aborted', 'AbortError') : new Error('Connection failed');
            const { service, terminals } = createService();
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
        const { service, terminals } = createService();
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
        const { service, terminals } = createService();
        const started = expect(service.start(makeTarget(makeContainerApp()))).to.be.rejectedWith(CancellationError);
        await waitFor(() => fetchMock.mock.callCount() > 0);

        service.dispose();
        response.resolve(new Response(null, { status: 302, headers: { location: LogStreamEndpoint } }));
        await started;

        expect(fetchMock.mock.callCount()).to.equal(1);
        expect(terminals).to.be.empty;
    });

    it('rejects starts after the service is disposed without making requests', async () => {
        const client = createMockContainerAppsClient();
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
        const { service, terminals } = createService();
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

    it('keeps the terminal open with the failure until a key is pressed when the stream breaks', async () => {
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('before\n'));
                controller.error(new Error('connection reset'));
            },
        });
        mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(body)));
        const { service, terminals } = createService();
        const closed = mock.fn((_code: unknown) => undefined);

        await service.start(makeTarget(makeContainerApp()));
        terminals[0].pty.onDidClose?.(closed);
        await waitFor(() => terminals[0].writes.join('').includes('Press any key'));

        expect(terminals[0].writes.join('')).to.include('The log stream ended unexpectedly: connection reset\r\n');
        expect(closed.mock.callCount()).to.equal(0);
        terminals[0].pty.handleInput?.('x');
        expect(closed.mock.calls.map(call => call.arguments[0])).to.deep.equal([0]);
        service.dispose();
    });

    it('cancels the stream when its terminal closes', async () => {
        const cancel = mock.fn();
        const fetchMock = mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(openBody(cancel), { status: 200 })));
        const app = makeContainerApp();
        const { service, terminals } = createService();
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
            const { service } = createService();

            await service.start(makeTarget(makeContainerApp({ subscription: makeSubscription({ environment }) }), endpoint));

            expect(fetchMock.mock.calls.map(call => call.arguments[0])).to.deep.equal([endpoint, destination]);
            const requests = fetchMock.mock.calls.map(call => call.arguments[1]);
            expect(requests[0]?.headers).to.deep.equal(requests[1]?.headers);
            expect(requests.every(request => request?.redirect === 'manual')).to.be.true;
            expect(requests[0]?.signal).to.equal(requests[1]?.signal);

            service.dispose();
        });

    }

    it('refuses a plain-http redirect', async () => {
        mock.method(globalThis, 'fetch', () => Promise.resolve(
            new Response(null, { status: 302, headers: { location: 'http://myapp.eastus.azurecontainerapps.io/logstream' } }),
        ));
        const { service } = createService();

        await expect(service.start(makeTarget(makeContainerApp()))).to.be.rejectedWith(/non-HTTPS/i);
    });

    it('bounds a redirect loop', async () => {
        const fetchMock = mock.method(globalThis, 'fetch', () => Promise.resolve(
            new Response(null, { status: 302, headers: { location: LogStreamEndpoint } }),
        ));
        const { service } = createService();

        await expect(service.start(makeTarget(makeContainerApp()))).to.be.rejectedWith(/too many times/i);
        expect(fetchMock.mock.callCount()).to.equal(6);
    });

    it('surfaces a rejection from the endpoint', async () => {
        mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(null, { status: 403 })));
        const { service } = createService();

        await expect(service.start(makeTarget(makeContainerApp()))).to.be.rejectedWith(/returned 403/i);
    });

    it('closes every terminal on dispose', async () => {
        mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(openBody(), { status: 200 })));
        const app = makeContainerApp();
        const { service, terminals } = createService();
        await service.start(makeTarget(app));

        service.dispose();

        expect(terminals[0].dispose.mock.callCount()).to.equal(1);
    });
});
