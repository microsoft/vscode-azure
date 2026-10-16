/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockFunctionsHostClient } from '@microsoft/vscode-azure-azutils/testing';
import { CancellationError } from '@microsoft/vscode-azure-utils';
import { addWorkspaceFolder, createMockProcessExecutor, createMockSpawn, createMockVsCode, getMockTaskExecution, MockCancellationToken, MockOutputChannel, waitFor } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { FunctionsHostTerminal } from '../../src/functions/host/FunctionsHostTerminal';
import { LocalFunctionsHostProcess } from '../../src/functions/host/LocalFunctionsHostProcess';
import { LocalFunctionsHostTracker } from '../../src/functions/host/LocalFunctionsHostTracker';
import { LocalFunctionsNetwork } from '../../src/functions/host/LocalFunctionsNetwork';
import { workerProcessId } from '../../src/functions/host/workerProcessId';
import { createMockFunctionsNetwork } from './mockFunctionsDebug';

function dotnetToolingLog(message: string): string {
    return JSON.stringify({
        ['schema_version']: 1, kind: 'log', timestamp: '2026-10-15T00:00:00.0000000+00:00',
        category: 'Host.Function.ToolingConsoleLog', level: 'information', ['event_id']: 0, message,
    });
}

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
        const { network, reserve } = createMockFunctionsNetwork();
        const output = new MockOutputChannel('functions');
        const written = mock.fn<(text: string) => void>();
        const finished = mock.fn<(code: number) => void>();
        // eslint-disable-next-line @typescript-eslint/unbound-method -- The wrapper supplies the terminal receiver with call().
        const openTerminal = FunctionsHostTerminal.prototype.open;
        mock.method(FunctionsHostTerminal.prototype, 'open', function (this: FunctionsHostTerminal) {
            this.onDidWrite(written);
            this.onDidClose(finished);
            openTerminal.call(this);
        });
        const owner = new LocalFunctionsHostProcess(m.vscode, processes, () => client, tracker, network, output);
        owners.push(owner);
        const request = { project, executable: 'func', runtime: 'node', skipBuild: true, hostArgs: [], prepare: () => Promise.resolve({}) };
        return { m, owner, request, spawn, client, tracker, network, reserve, terminateTree, output, written, finished };
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
        expect(args).to.deep.equal([
            'run', s.request.project.fsPath, '--port', String(host.hostPort), '--no-build', '--no-azurite', '--output', 'plain',
        ]);
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

    for (const skipBuild of [false, true]) {
        it(`reports early CLI failure with skipBuild=${String(skipBuild)} instead of cancellation`, async () => {
            const s = setup({ keepAlive: false, exitCode: 1 });
            mock.method(s.network, 'listening', () => Promise.resolve(false));
            await expect(s.owner.start({ ...s.request, skipBuild })).to.be.rejectedWith('Functions host failed');
            expect(s.tracker.get(s.request.project)).to.be.undefined;
            expect(s.finished.mock.calls.map(call => call.arguments[0])).to.deep.equal([1]);
        });
    }

    it('stops the owned process and reports a failed output stream', async () => {
        const s = setup({ keepStreamsOpen: true });
        mock.method(s.network, 'listening', () => Promise.resolve(false));
        const starting = s.owner.start(s.request);
        const rejected = expect(starting).to.be.rejectedWith('host output stream failed');
        await waitFor(() => s.spawn.mock.callCount() === 1);
        s.spawn.mock.calls[0].result?.stdout?.destroy(new Error('Output pipe failed'));
        await rejected;
        expect(s.terminateTree.mock.callCount()).to.equal(1);
        expect(s.tracker.get(s.request.project)).to.be.undefined;
    });

    for (const attached of [false, true]) {
        it(`retains failed readiness output and awaits process-tree shutdown ${attached ? 'after' : 'before'} debugger attachment`, async () => {
            const s = setup({ stdout: 'Core Tools startup diagnostics\n' });
            const status = Promise.withResolvers<Awaited<ReturnType<typeof s.client.getStatus>>>();
            s.client.getStatus.mock.mockImplementation(() => status.promise);
            mock.method(s.network, 'listening', () => Promise.resolve(attached));
            const starting = s.owner.start(s.request);
            const rejected = attached ? undefined : expect(starting).to.be.rejectedWith('host rejected its readiness request');
            const execution = await getMockTaskExecution(s.m);
            const terminateTask = mock.method(execution, 'terminate');
            if (attached) { await starting; }
            await waitFor(() => s.client.getStatus.mock.callCount() > 0);
            status.reject(Object.assign(new Error('Host authentication required.'), { statusCode: 401 }));
            if (rejected) { await rejected; }
            await waitFor(() => s.finished.mock.callCount() === 1);
            expect(s.terminateTree.mock.callCount()).to.equal(1);
            expect(terminateTask.mock.callCount()).to.equal(0);
            expect(s.tracker.get(s.request.project)).to.be.undefined;
            expect(s.finished.mock.calls.map(call => call.arguments[0])).to.deep.equal([1]);
            expect(s.written.mock.calls.map(call => call.arguments[0]).join(''))
                .to.include('Core Tools startup diagnostics\r\n')
                .and.include('host rejected its readiness request');
        });
    }

    it('waits for process-tree termination before finishing a failed host task', async () => {
        const s = setup({ keepStreamsOpen: true });
        const status = Promise.withResolvers<Awaited<ReturnType<typeof s.client.getStatus>>>();
        const shutdown = Promise.withResolvers<undefined>();
        s.client.getStatus.mock.mockImplementation(() => status.promise);
        s.terminateTree.mock.mockImplementationOnce(() => shutdown.promise, 0);
        mock.method(s.network, 'listening', () => Promise.resolve(false));
        const starting = s.owner.start(s.request);
        const rejected = expect(starting).to.be.rejectedWith('host rejected its readiness request');
        const execution = await getMockTaskExecution(s.m);
        const terminateTask = mock.method(execution, 'terminate');
        await waitFor(() => s.client.getStatus.mock.callCount() > 0);
        status.reject(Object.assign(new Error('Host authentication required.'), { statusCode: 401 }));
        await waitFor(() => s.terminateTree.mock.callCount() === 1);
        expect(s.finished.mock.callCount()).to.equal(0);
        expect(terminateTask.mock.callCount()).to.equal(0);
        const child = s.spawn.mock.calls[0].result;
        child?.stdout?.push(null);
        child?.stderr?.push(null);
        child?.emit('close', 0, null);
        shutdown.resolve(undefined);
        await rejected;
        expect(s.finished.mock.calls.map(call => call.arguments[0])).to.deep.equal([1]);
        expect(s.terminateTree.mock.callCount()).to.equal(1);
        expect(s.tracker.get(s.request.project)).to.be.undefined;
    });

    for (const [skipBuild, timeout] of [[true, 120_000], [false, 300_000]] as const) {
        it(`stops the owned process when debugger readiness reaches its ${timeout / 1000}-second deadline`, async () => {
            const s = setup();
            const now = Date.now();
            const clock = mock.method(Date, 'now', () => now + timeout);
            clock.mock.mockImplementationOnce(() => now, 0);
            clock.mock.mockImplementationOnce(() => now + timeout - 100, 1);
            const listening = mock.method(s.network, 'listening', () => Promise.resolve(false));
            const ended = mock.fn();
            const subscription = s.m.taskEndEmitter.event(ended);
            s.client.getStatus.mock.mockImplementation(() => Promise.resolve({ state: 'Starting' }));
            await expect(s.owner.start({ ...s.request, skipBuild })).to.be.rejectedWith('worker did not expose its debugger');
            expect(listening.mock.callCount()).to.equal(1);
            expect(s.terminateTree.mock.callCount()).to.equal(1);
            expect(s.tracker.get(s.request.project)).to.be.undefined;
            const execution = await s.m.tasks.executeTask.mock.calls[0].result;
            if (!execution) { throw new Error('Expected the owned host task.'); }
            expect(ended.mock.calls[0].arguments[0]).to.deep.equal({ execution });
            expect(s.finished.mock.calls.map(call => call.arguments[0])).to.deep.equal([1]);
            expect(s.written.mock.calls.map(call => call.arguments[0]).join('')).to.include('worker did not expose its debugger');
            subscription.dispose();
        });
    }

    it('runs from the project root and delegates compilation to Core Tools when requested', async () => {
        const s = setup();
        const host = await s.owner.start({ ...s.request, skipBuild: false });
        expect(s.spawn.mock.calls[0].arguments[1]).to.deep.equal([
            'run', s.request.project.fsPath, '--port', String(host.hostPort), '--no-azurite', '--output', 'plain',
        ]);
        expect(s.spawn.mock.calls[0].arguments[2]?.cwd).to.equal(s.request.project.fsPath);
        await s.owner.stop(host.id);
    });

    for (const failure of ['preparation', 'task launch'] as const) {
        it(`releases both ports and permits another start after ${failure} fails`, async () => {
            const s = setup();
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
            expect(s.reserve.mock.callCount()).to.equal(2);
            for (const call of s.reserve.mock.calls) {
                const reservation = await call.result;
                if (!reservation) { throw new Error('Expected a reserved host or debugger port.'); }
                expect(reservation.release.mock.callCount()).to.equal(1);
            }
            const host = await s.owner.start(s.request);
            expect(s.spawn.mock.callCount()).to.equal(1);
            await s.owner.stop(host.id);
        });
    }

    it('releases the host reservation when the debugger port is unavailable and permits retry', async () => {
        const s = setup();
        s.reserve.mock.mockImplementationOnce(() => Promise.reject(Object.assign(new Error('Port in use'), { code: 'EADDRINUSE' })), 1);
        await expect(s.owner.start(s.request)).to.be.rejectedWith('port is already in use');
        const hostPort = await s.reserve.mock.calls[0].result;
        expect(hostPort?.release.mock.callCount()).to.equal(1);
        expect(s.spawn.mock.callCount()).to.equal(0);
        const host = await s.owner.start(s.request);
        await s.owner.stop(host.id);
    });

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
        expect(s.finished.mock.calls.map(call => call.arguments[0])).to.deep.equal([1]);
        expect(s.written.mock.calls.map(call => call.arguments[0]).join('')).to.include('Could not terminate the owned Functions process tree');
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

    for (const [channel, message] of [
        ['stdout', 'azfuncjsonlog:{"name":"dotnet-worker-startup","workerProcessId":1234}'],
        ['stderr', 'Azure Functions .NET Worker (PID: 1234) initialized in debug mode.'],
    ] as const) {
        it(`extracts a v5 .NET worker PID from ${channel} before HTTP readiness`, async () => {
            const line = dotnetToolingLog(message);
            const chunks = [line.slice(0, 30), line.slice(30), '\n'];
            const s = setup(channel === 'stdout' ? { stdoutChunks: chunks } : { stderr: `${line}\n` });
            s.client.getStatus.mock.mockImplementation(() => Promise.resolve({ state: 'Starting' }));
            const host = await s.owner.start({ ...s.request, runtime: 'dotnet-isolated' });
            expect(host.workerPid).to.equal(1234);
            expect(s.tracker.get(s.request.project)).to.be.undefined;
            expect(s.spawn.mock.calls[0].arguments[1]).to.deep.equal([
                'run', s.request.project.fsPath, '--port', String(host.hostPort), '--no-build', '--no-azurite',
                '--output', 'json', '--dotnet-isolated-debug', '--enable-json-output',
            ]);
            await s.owner.stop(host.id);
        });
    }

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
        const debugPort = 19001;
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
    it('delivers buffered failure details before ending an unopened task without starting its process', () => {
        const start = mock.fn();
        const cancel = mock.fn();
        const terminal = new FunctionsHostTerminal(start, cancel);
        const written = mock.fn<(text: string) => void>();
        const finished = mock.fn<(code: number) => void>();
        terminal.onDidWrite(written);
        terminal.onDidClose(finished);
        terminal.write('Startup failed.\n');
        terminal.finish(1);
        expect(finished.mock.callCount()).to.equal(0);
        terminal.open();
        terminal.open();
        terminal.finish(1);
        expect(written.mock.calls.map(call => call.arguments[0])).to.deep.equal(['Startup failed.\r\n']);
        expect(finished.mock.calls.map(call => call.arguments[0])).to.deep.equal([1]);
        expect(start.mock.callCount()).to.equal(0);
        expect(cancel.mock.callCount()).to.equal(1);
    });

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

    it('reads v5 tooling-category startup messages with positive safe-integer PIDs', () => {
        expect(workerProcessId(dotnetToolingLog('azfuncjsonlog:{"name":"dotnet-worker-startup","workerProcessId":2345}'))).to.equal(2345);
        expect(workerProcessId(dotnetToolingLog('Azure Functions .NET Worker (PID: 2345) initialized in debug mode.'))).to.equal(2345);
        expect(workerProcessId(JSON.stringify({
            category: 'host.function.toolingconsolelog', message: 'Azure Functions .NET Worker (PID: 2345) initialized in debug mode.',
        }))).to.equal(2345);
        for (const pid of ['0', '-1', '1.5', '9007199254740992', 'not-a-pid']) {
            expect(workerProcessId(dotnetToolingLog(`Azure Functions .NET Worker (PID: ${pid}) initialized in debug mode.`))).to.be.undefined;
        }
        for (const category of ['Function.user', undefined]) {
            expect(workerProcessId(JSON.stringify({
                category, message: 'Azure Functions .NET Worker (PID: 2345) initialized in debug mode.',
            }))).to.be.undefined;
        }
    });
});

describe('Functions loopback ports (integration)', () => {
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
