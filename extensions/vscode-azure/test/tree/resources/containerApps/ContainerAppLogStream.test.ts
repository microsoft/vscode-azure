/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { GenericResource } from '@microsoft/vscode-azure-azutils';
import { createMockContainerAppsClient, makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import { createMockVsCode, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { ContainerAppResourceType } from '../../../../src/tree/resources/containerApps/ContainerApp';
import { ContainerAppLogStreamService, type LogStreamTarget } from '../../../../src/tree/resources/containerApps/ContainerAppLogStream';

const LogStreamEndpoint = 'https://myapp.eastus.azurecontainerapps.io/logstream';

function makeApp(): GenericResource {
    return makeGenericResource({
        id: '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/MyRG/providers/Microsoft.App/containerApps/MyApp',
        name: 'MyApp',
        type: ContainerAppResourceType,
        logicalType: ContainerAppResourceType,
    });
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

/** Builds a service whose `fetch` is replaced by the supplied implementation. */
function createService(client: ReturnType<typeof createClient>) {
    const { vscode } = createMockVsCode();
    const { executor } = createTestActionExecutor();
    return new ContainerAppLogStreamService(vscode, executor, () => client);
}

/** A never-ending body, so a started stream stays open for the assertions. */
function openBody(): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new TextEncoder().encode('hello\n'));
        },
    });
}

describe('ContainerAppLogStreamService (unit)', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    it('tracks a started stream against its app', async () => {
        mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(openBody(), { status: 200 })));
        const app = makeApp();
        const service = createService(createStreamingClient());

        await service.start(makeTarget(app));

        expect(service.isStreaming(app.id)).to.be.true;
        expect(service.getActiveStreams()).to.have.lengthOf(1);
        expect(service.getActiveStreams()[0].label).to.equal('replica1 (api)');

        service.dispose();
    });

    it('matches the app id case-insensitively', async () => {
        mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(openBody(), { status: 200 })));
        const app = makeApp();
        const service = createService(createStreamingClient());

        await service.start(makeTarget(app));

        expect(service.isStreaming(app.id.toUpperCase())).to.be.true;

        service.dispose();
    });

    it('reuses the existing stream when the same container is started twice', async () => {
        const fetchMock = mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(openBody(), { status: 200 })));
        const app = makeApp();
        const service = createService(createStreamingClient());

        await service.start(makeTarget(app));
        await service.start(makeTarget(app));

        expect(service.getActiveStreams()).to.have.lengthOf(1);
        expect(fetchMock.mock.callCount()).to.equal(1);

        service.dispose();
    });

    it('stops a stream and reports it as no longer live', async () => {
        mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(openBody(), { status: 200 })));
        const app = makeApp();
        const service = createService(createStreamingClient());
        await service.start(makeTarget(app));

        const changed: string[] = [];
        service.onDidChangeStreams(changedApp => changed.push(changedApp.id));
        service.stop(service.getActiveStreams()[0].id);

        expect(service.isStreaming(app.id)).to.be.false;
        expect(service.getActiveStreams()).to.be.empty;
        expect(changed).to.deep.equal([app.id]);

        service.dispose();
    });

    it('follows a redirect that stays inside the Container Apps data plane', async () => {
        const urls: string[] = [];
        mock.method(globalThis, 'fetch', (url: string) => {
            urls.push(url);
            return Promise.resolve(urls.length === 1
                ? new Response(null, { status: 302, headers: { location: 'https://other.eastus.azurecontainerapps.io/logstream' } })
                : new Response(openBody(), { status: 200 }));
        });
        const service = createService(createStreamingClient());

        await service.start(makeTarget(makeApp()));

        expect(urls).to.deep.equal([LogStreamEndpoint, 'https://other.eastus.azurecontainerapps.io/logstream']);

        service.dispose();
    });

    it('refuses to send the token to a host outside the Container Apps data plane', async () => {
        // Following this blindly would hand an Azure credential to an
        // attacker-named host, so the redirect must be rejected outright.
        mock.method(globalThis, 'fetch', () => Promise.resolve(
            new Response(null, { status: 302, headers: { location: 'https://evil.example.com/steal' } }),
        ));
        const service = createService(createStreamingClient());

        await expect(service.start(makeTarget(makeApp()))).to.be.rejectedWith(/redirected outside/i);
        expect(service.getActiveStreams()).to.be.empty;
    });

    it('refuses a plain-http redirect', async () => {
        mock.method(globalThis, 'fetch', () => Promise.resolve(
            new Response(null, { status: 302, headers: { location: 'http://myapp.eastus.azurecontainerapps.io/logstream' } }),
        ));
        const service = createService(createStreamingClient());

        await expect(service.start(makeTarget(makeApp()))).to.be.rejectedWith(/redirected outside/i);
    });

    it('reports a container that exposes no endpoint', async () => {
        const service = createService(createClient(undefined));

        await expect(service.start(makeTarget(makeApp()))).to.be.rejectedWith(/No log stream is available/i);
    });

    it('surfaces a rejection from the endpoint', async () => {
        mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(null, { status: 403 })));
        const service = createService(createStreamingClient());

        await expect(service.start(makeTarget(makeApp()))).to.be.rejectedWith(/returned 403/i);
    });

    it('stops every stream on dispose', async () => {
        mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(openBody(), { status: 200 })));
        const app = makeApp();
        const service = createService(createStreamingClient());
        await service.start(makeTarget(app));

        service.dispose();

        expect(service.getActiveStreams()).to.be.empty;
    });
});
