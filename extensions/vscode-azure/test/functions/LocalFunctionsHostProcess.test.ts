/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockFunctionsHostClient } from '@microsoft/vscode-azure-azutils/testing';
import { CancellationError } from '@microsoft/vscode-azure-utils';
import { addWorkspaceFolder, createMockProcessExecutor, createMockSpawn, createMockVsCode, MockCancellationToken, MockOutputChannel, waitFor } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { FunctionsHostTerminal } from '../../src/functions/host/FunctionsHostTerminal';
import { LocalFunctionsHostProcess } from '../../src/functions/host/LocalFunctionsHostProcess';
import { LocalFunctionsHostTracker } from '../../src/functions/host/LocalFunctionsHostTracker';
import { LocalFunctionsNetwork } from '../../src/functions/host/LocalFunctionsNetwork';
import { workerProcessId } from '../../src/functions/host/workerProcessId';

describe('Local Functions host ownership (unit)', () => {
    const owners: LocalFunctionsHostProcess[] = [];
    afterEach(() => { owners.splice(0).forEach(owner => { owner.dispose(); }); mock.restoreAll(); });

    function setup(options?: Parameters<typeof createMockSpawn>[0], open = true) {
        const m = createMockVsCode(undefined, { openTaskTerminalsOnExecute: open });
        const project = addWorkspaceFolder(m, '/repo').uri;
        const { executor: processes, spawn, terminateTree } = createMockProcessExecutor(m.vscode, { keepAlive: true, ...options });
        const client = createMockFunctionsHostClient();
        client.getStatus.mock.mockImplementation(() => Promise.resolve({ state: 'Running' }));
        const tracker = new LocalFunctionsHostTracker();
        const network = new LocalFunctionsNetwork();
        mock.method(network, 'listening', () => Promise.resolve(true));
        const owner = new LocalFunctionsHostProcess(m.vscode, processes, () => client, tracker, network, new MockOutputChannel('functions'));
        owners.push(owner);
        const request = { project, cwd: project, executable: 'func', runtime: 'node', hostArgs: [], prepare: () => Promise.resolve({}) };
        return { m, owner, request, spawn, client, tracker, network, terminateTree };
    }

    it('registers the exact owned port only after HTTP Running and removes it on stop', async () => {
        const s = setup();
        s.client.getStatus.mock.mockImplementation(() => Promise.resolve({ state: 'Starting' }));
        const host = await s.owner.start(s.request);
        expect(s.tracker.get(s.request.project)).to.be.undefined;
        s.client.getStatus.mock.mockImplementation(() => Promise.resolve({ state: 'Running' }));
        await waitFor(() => !!s.tracker.get(s.request.project));
        expect(s.tracker.get(s.request.project)?.port).to.equal(host.hostPort);
        const args = s.spawn.mock.calls[0].arguments[1];
        expect(args).to.include('--address');
        expect(args).to.include('127.0.0.1');
        await s.owner.stop(host.id);
        expect(s.tracker.get(s.request.project)).to.be.undefined;
        await s.owner.stop(host.id);
    });

    it('rejects concurrent starts while ports are still being reserved', async () => {
        const s = setup();
        const first = s.owner.start(s.request);
        await expect(s.owner.start(s.request)).to.be.rejectedWith('already has an owned host');
        const host = await first;
        expect(s.spawn.mock.callCount()).to.equal(1);
        await s.owner.stop(host.id);
    });

    it('reports early process failure instead of cancellation', async () => {
        const s = setup({ keepAlive: false, exitCode: 1 });
        mock.method(s.network, 'listening', () => Promise.resolve(false));
        await expect(s.owner.start(s.request)).to.be.rejectedWith('Functions host failed');
        expect(s.tracker.get(s.request.project)).to.be.undefined;
    });

    it('reports a rejected readiness request and terminates the owned process tree', async () => {
        const s = setup();
        mock.method(s.network, 'listening', () => Promise.resolve(false));
        s.client.getStatus.mock.mockImplementation(() => Promise.reject(Object.assign(new Error('Host authentication required.'), { statusCode: 401 })));
        await expect(s.owner.start(s.request)).to.be.rejectedWith('host rejected its readiness request');
        expect(s.terminateTree.mock.callCount()).to.equal(1);
        expect(s.tracker.get(s.request.project)).to.be.undefined;
    });

    it('cancels before a custom task opens without launching a process', async () => {
        const s = setup(undefined, false);
        const token = new MockCancellationToken();
        const start = s.owner.start(s.request, token);
        const rejected = expect(start).to.be.rejectedWith(CancellationError);
        await waitFor(() => s.m.tasks.executeTask.mock.callCount() === 1);
        token.cancel();
        await rejected;
        expect(s.spawn.mock.callCount()).to.equal(0);
        expect(s.tracker.get(s.request.project)).to.be.undefined;
    });

    it('extracts a fragmented structured .NET worker PID before HTTP readiness', async () => {
        const line = JSON.stringify({ Message: 'azfuncjsonlog:{"name":"dotnet-worker-startup","workerProcessId":1234}' });
        const s = setup({ stdoutChunks: [line.slice(0, 30), line.slice(30), '\n'] });
        s.client.getStatus.mock.mockImplementation(() => Promise.resolve({ state: 'Starting' }));
        const host = await s.owner.start({ ...s.request, runtime: 'dotnet-isolated' });
        expect(host.workerPid).to.equal(1234);
        expect(s.tracker.get(s.request.project)).to.be.undefined;
        expect(s.spawn.mock.calls[0].arguments[1]).to.include('--dotnet-isolated-debug');
        await s.owner.stop(host.id);
    });

    it('cancels a running owned process when its task ends', async () => {
        const s = setup();
        const host = await s.owner.start(s.request);
        const execution = await s.m.tasks.executeTask.mock.calls[0].result;
        if (!execution) { throw new Error('The host task did not start.'); }
        s.m.taskEndEmitter.fire({ execution });
        await waitFor(() => !s.tracker.get(s.request.project));
        await s.owner.stop(host.id);
        expect(s.terminateTree.mock.callCount()).to.equal(1);
    });
});

describe('Functions host terminal (unit)', () => {
    it('starts at most once and never starts after close', () => {
        const start = mock.fn();
        const closed = new FunctionsHostTerminal(start, mock.fn());
        closed.close();
        closed.open();
        expect(start.mock.callCount()).to.equal(0);
        const terminal = new FunctionsHostTerminal(start, mock.fn());
        terminal.open();
        terminal.open();
        expect(start.mock.callCount()).to.equal(1);
        terminal.close();
    });
});

describe('Functions worker PID (unit)', () => {
    it('reads startup events in plain and wrapped output without accepting unrelated PIDs', () => {
        const event = { name: 'dotnet-worker-startup', workerProcessId: 2345 };
        expect(workerProcessId(JSON.stringify(event))).to.equal(2345);
        expect(workerProcessId(`info: azfuncjsonlog:${JSON.stringify(event)}`)).to.equal(2345);
        expect(workerProcessId(JSON.stringify({ message: `azfuncjsonlog:${JSON.stringify(event)}` }))).to.equal(2345);
        for (const line of ['not json', '{"workerProcessId":1234}', '{"name":"other","workerProcessId":1234}',
            '{"name":"dotnet-worker-startup","workerProcessId":-1}', '{"name":"dotnet-worker-startup","workerProcessId":"1234"}']) {
            expect(workerProcessId(line)).to.be.undefined;
        }
    });
});

describe('Functions loopback ports (unit)', () => {
    it('holds a unique loopback port and releases it idempotently', async () => {
        const network = new LocalFunctionsNetwork();
        const port = await network.reserve();
        try {
            expect(await network.listening(port.port)).to.be.true;
            await expect(network.reserve(port.port)).to.be.rejected;
        } finally { await port.release(); }
        await port.release();
        const reused = await network.reserve(port.port);
        await reused.release();
        expect(await network.listening(port.port)).to.be.false;
    });
});
