/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { GenericResource } from '@microsoft/vscode-azure-azutils';
import { createMockContainerAppsClient, makeContainerApp } from '@microsoft/vscode-azure-azutils/testing';
import { createMockVsCode, createTestActionExecutor, waitFor } from '@microsoft/vscode-azure-utils/testing';
import { mock, type Mock } from 'node:test';
import type * as vscode from 'vscode';
import { ContainerAppLogStreamService, type LogStreamTarget } from '../../../../src/tree/resources/containerApps/ContainerAppLogStream';

const LogStreamEndpoint = 'https://myapp.eastus.azurecontainerapps.io/logstream';

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

    it('cancels the stream when its terminal closes', async () => {
        let cancelled = false;
        mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(openBody(() => { cancelled = true; }), { status: 200 })));
        const app = makeContainerApp();
        const { service, terminals } = createService(createStreamingClient());
        await service.start(makeTarget(app));

        terminals[0].pty.close();
        await waitFor(() => cancelled);

        await service.start(makeTarget(app));
        expect(terminals).to.have.lengthOf(2);

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
        const { service } = createService(createStreamingClient());

        await service.start(makeTarget(makeContainerApp()));

        expect(urls).to.deep.equal([LogStreamEndpoint, 'https://other.eastus.azurecontainerapps.io/logstream']);

        service.dispose();
    });

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
