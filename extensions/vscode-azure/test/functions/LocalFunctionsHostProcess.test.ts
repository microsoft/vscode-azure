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
        const output = new MockOutputChannel('functions');
        const owner = new LocalFunctionsHostProcess(m.vscode, processes, () => client, tracker, network, output);
        owners.push(owner);
        const request = { project, cwd: project, executable: 'func', runtime: 'node', hostArgs: [], prepare: () => Promise.resolve({}) };
        return { m, owner, request, spawn, client, tracker, network, terminateTree, output };
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

    it('stops the owned process when debugger readiness reaches its 120-second deadline', async () => {
        const s = setup();
        const now = Date.now();
        const clock = mock.method(Date, 'now', () => now + 120_000);
        clock.mock.mockImplementationOnce(() => now, 0);
        clock.mock.mockImplementationOnce(() => now + 119_900, 1);
        const listening = mock.method(s.network, 'listening', () => Promise.resolve(false));
        const ended = mock.fn();
        const subscription = s.m.taskEndEmitter.event(ended);
        s.client.getStatus.mock.mockImplementation(() => Promise.resolve({ state: 'Starting' }));
        await expect(s.owner.start(s.request)).to.be.rejectedWith('worker did not expose its debugger');
        expect(listening.mock.callCount()).to.equal(1);
        expect(s.terminateTree.mock.callCount()).to.equal(1);
        expect(s.tracker.get(s.request.project)).to.be.undefined;
        const execution = await s.m.tasks.executeTask.mock.calls[0].result;
        if (!execution) { throw new Error('Expected the owned host task.'); }
        expect(ended.mock.calls[0].arguments[0]).to.deep.equal({ execution });
        subscription.dispose();
    });

    for (const failure of ['preparation', 'task launch'] as const) {
        it(`releases both ports and permits another start after ${failure} fails`, async () => {
            const s = setup();
            const reserve = mock.method(s.network, 'reserve', s.network.reserve.bind(s.network));
            const prepare = mock.fn(s.request.prepare);
            if (failure === 'preparation') {
                prepare.mock.mockImplementationOnce(() => Promise.reject(new Error('Preparation failed.')), 0);
            } else {
                s.m.tasks.executeTask.mock.mockImplementationOnce(() => Promise.reject(new Error('Task launch failed.')), 0);
            }
            await expect(s.owner.start({ ...s.request, prepare })).to.be.rejectedWith(
                failure === 'preparation' ? 'Preparation failed.' : 'Task launch failed.',
            );
            expect(s.spawn.mock.callCount()).to.equal(0);
            expect(s.tracker.get(s.request.project)).to.be.undefined;
            for (const call of reserve.mock.calls) {
                const reservation = await call.result;
                if (!reservation) { throw new Error('Expected a reserved host or debugger port.'); }
                const port = await s.network.reserve(reservation.port);
                await port.release();
            }
            const host = await s.owner.start(s.request);
            expect(s.spawn.mock.callCount()).to.equal(1);
            await s.owner.stop(host.id);
        });
    }

    it('surfaces process-tree termination failure through stop and removes the ready registration', async () => {
        const s = setup();
        const warning = mock.method(s.output, 'warn');
        const host = await s.owner.start(s.request);
        await waitFor(() => !!s.tracker.get(s.request.project));
        s.terminateTree.mock.mockImplementationOnce(() => Promise.reject(new Error('Tree termination denied.')), 0);
        await expect(s.owner.stop(host.id)).to.be.rejectedWith('Could not terminate the owned Functions process tree');
        expect(s.terminateTree.mock.callCount()).to.equal(1);
        expect(s.tracker.get(s.request.project)).to.be.undefined;
        expect(warning.mock.calls[0].arguments[0]).to.equal('[functions] Owned process-tree termination failed.');
        s.spawn.mock.calls[0].result?.emit('close', 0, null);
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

    it('preserves the prepared Go binary and stops the owned host/Delve/worker tree on cancellation', async () => {
        const port = await new LocalFunctionsNetwork().reserve();
        const debugPort = port.port;
        await port.release();
        const marker = `[host] API server listening at: 127.0.0.1:${debugPort}\n`;
        const s = setup({ stdoutChunks: [marker.slice(0, 12), marker.slice(12)] });
        const token = new MockCancellationToken();
        const host = await s.owner.start({
            ...s.request, runtime: 'native', debugPort,
            prepare: port => Promise.resolve({
                ['languageWorkers__native__defaultExecutablePath']: '/tools/dlv',
                ['languageWorkers__native__arguments']: `exec bin/app --headless --continue --listen=127.0.0.1:${port} --`,
            }),
        }, token);
        const args = s.spawn.mock.calls[0].arguments[1];
        expect(args).to.include('--no-build');
        expect(args).to.not.include('--dotnet-isolated-debug');
        expect(s.spawn.mock.calls[0].arguments[2]?.env?.languageWorkers__native__arguments).to.include(`127.0.0.1:${host.debugPort}`);
        token.cancel();
        await s.owner.stop(host.id);
        expect(s.terminateTree.mock.callCount()).to.equal(1);
        expect(s.tracker.get(s.request.project)).to.be.undefined;
    });

    it('does not return a Go attachment for an unrelated listener or a marker for another port', async () => {
        const s = setup({ stdout: 'API server listening at: 127.0.0.1:0\n' });
        const token = new MockCancellationToken();
        const start = s.owner.start({ ...s.request, runtime: 'native' }, token);
        const rejected = expect(start).to.be.rejectedWith(CancellationError);
        await waitFor(() => s.spawn.mock.callCount() === 1);
        await waitFor(() => s.client.getStatus.mock.callCount() > 0);
        token.cancel();
        await rejected;
        expect(s.terminateTree.mock.callCount()).to.equal(1);
    });

    it('reports Go/Delve startup failure and closes only its owned host', async () => {
        const s = setup({ keepAlive: false, exitCode: 1 });
        mock.method(s.network, 'listening', () => Promise.resolve(false));
        await expect(s.owner.start({ ...s.request, runtime: 'native' })).to.be.rejectedWith('Functions host failed');
        expect(s.tracker.get(s.request.project)).to.be.undefined;
        expect(s.spawn.mock.callCount()).to.equal(1);
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
