/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProcessError } from '@azure/core-process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { mock, type Mock } from 'node:test';
import type * as vscode from 'vscode';
import { URI as Uri } from 'vscode-uri';
import { command, type CommandLineArgs } from '../../src/base/CommandLineBuilder';
import { delay } from '../../src/base/delay';
import { ProcessExecutor, WindowsLauncherExitGraceMs, type ResolveExecutableFn } from '../../src/base/IProcessExecutor';
import { CancellationError } from '../../src/vscode/CancellationError';
import { EventEmitter } from '../../src/vscode/EventEmitter';
import { createMockVsCode, getMockTaskExecution } from '../vscode/MockVsCode';
import { createMockProcessExecutor, createMockSpawn } from './mockProcess';
import { collectAsync } from '../../src/data/collectAsync';
import { waitFor } from '../waitFor';

describe('ProcessExecutor (unit)', () => {
    describe('background execution', () => {
        afterEach(() => {
            mock.restoreAll();
        });

        it('should capture stdout and stderr', async () => {
            const { vscode: code } = createMockVsCode();
            const spawnFn = createMockSpawn({ stdout: 'out', stderr: 'err' });
            const executor = new ProcessExecutor(code, spawnFn);

            const result = await executor.spawn({
                execution: 'background',
                command: ['test-cmd', 'arg1'],
            });

            expect(result.stdout).to.equal('out');
            expect(result.stderr).to.equal('err');
        });

        it('should parse stdout as JSON when parseJson is true', async () => {
            const { vscode: code } = createMockVsCode();
            const spawnFn = createMockSpawn({ stdout: '{"key":"value"}' });
            const executor = new ProcessExecutor(code, spawnFn);

            const result = await executor.spawn<{ key: string }>({
                execution: 'background',
                command: ['test-cmd'],
                parseJson: true,
            });

            expect(result.json).to.deep.equal({ key: 'value' });
            expect(result.stdout).to.equal('{"key":"value"}');
        });

        it('streams both output channels without retaining process output', async () => {
            const { vscode: code } = createMockVsCode();
            const executor = new ProcessExecutor(code, createMockSpawn({ stdout: 'host ready', stderr: 'worker message' }));
            const result = await executor.spawn({
                execution: 'background', command: ['func', 'host', 'start'], streamOutput: true,
            });

            const [stdout, stderr] = await Promise.all([collectAsync(result.stdout), collectAsync(result.stderr)]);
            expect(stdout).to.deep.equal(['host ready']);
            expect(stderr).to.deep.equal(['worker message']);
            await result.completed;
        });

        it('reports process failure while streaming output', async () => {
            const { vscode: code } = createMockVsCode();
            const executor = new ProcessExecutor(code, createMockSpawn({ stderr: 'host failure', exitCode: 2 }));
            const result = await executor.spawn({
                execution: 'background', command: ['func'], streamOutput: true,
            });
            const [stdout, stderr] = await Promise.all([collectAsync(result.stdout), collectAsync(result.stderr)]);
            expect(stdout).to.deep.equal([]);
            expect(stderr).to.deep.equal(['host failure']);
            const error: ProcessError = await expect(result.completed).to.be.rejectedWith(ProcessError);
            expect(error.code).to.equal(2);
            expect(error.stdout).to.equal('');
            expect(error.stderr).to.equal('');
            expect(error.message).to.not.contain('host failure');
        });

        it('propagates an unrelated stream error to the output consumer', async () => {
            const spawn = createMockSpawn({ keepAlive: true, keepStreamsOpen: true });
            const executor = new ProcessExecutor(createMockVsCode().vscode, spawn);
            const result = await executor.spawn({
                execution: 'background', command: ['func'], streamOutput: true,
            });
            const child = spawn.mock.calls[0].result!;
            const failure = new Error('Output stream failed');
            const output = collectAsync(result.stdout);
            const rejection = expect(output).to.be.rejected;

            child.stdout!.destroy(failure);

            try {
                expect(await rejection).to.equal(failure);
            } finally {
                child.stderr!.push(null);
                child.emit('close', 0, null);
                await result.completed;
            }
        });

        it('pauses unread output and preserves chunk order within each channel', async () => {
            const spawn = createMockSpawn({ stdoutChunks: ['first', 'second', 'third'], stderrLines: ['error one', 'error two'] });
            const executor = new ProcessExecutor(createMockVsCode().vscode, spawn);
            const result = await executor.spawn({ execution: 'background', command: ['func'], streamOutput: true });
            await waitFor(() => spawn.mock.calls[0].result?.stdout?.isPaused() === true);
            const [stdout, stderr] = await Promise.all([collectAsync(result.stdout), collectAsync(result.stderr)]);
            expect(stdout).to.deep.equal(['first', 'second', 'third']);
            expect(stderr).to.deep.equal(['error one\n', 'error two\n']);
            await result.completed;
        });

        it('drains remaining output when the consumer stops early', async () => {
            const executor = new ProcessExecutor(createMockVsCode().vscode, createMockSpawn({
                stdoutChunks: ['first', 'second', 'third'], stderrLines: ['error one', 'error two'],
            }));
            const result = await executor.spawn({ execution: 'background', command: ['func'], streamOutput: true });
            for await (const text of result.stdout) {
                expect(text).to.equal('first');
                break;
            }
            expect(await collectAsync(result.stderr)).to.deep.equal(['error one\n', 'error two\n']);
            await result.completed;
        });

        for (const method of ['return', 'throw'] as const) {
            it(`drains both channels after ${method} before their first next call`, async () => {
                const spawn = createMockSpawn({
                    stdoutChunks: ['first', 'second', 'third'],
                    stderrLines: ['error one', 'error two', 'error three'],
                });
                const executor = new ProcessExecutor(createMockVsCode().vscode, spawn);
                const result = await executor.spawn({ execution: 'background', command: ['func'], streamOutput: true });
                const child = spawn.mock.calls[0].result!;
                await waitFor(() => child.stdout!.isPaused() && child.stderr!.isPaused());

                for (const channel of ['stdout', 'stderr'] as const) {
                    const stream = child[channel]!;
                    expect(stream.listenerCount('data')).to.equal(1);
                    if (method === 'return') {
                        expect(await result[channel].return(undefined)).to.deep.equal({ value: undefined, done: true });
                    } else {
                        const error = new Error('Consumer stopped.');
                        expect(await expect(result[channel].throw(error)).to.be.rejected).to.equal(error);
                    }
                    for (const event of ['data', 'end', 'close', 'error']) {
                        expect(stream.listenerCount(event), `${channel} ${event} listeners`).to.equal(0);
                    }
                    expect(stream.isPaused()).to.equal(false);
                    expect(await result[channel].next()).to.deep.equal({ value: undefined, done: true });
                }

                await waitFor(() => child.stdout!.readableEnded && child.stderr!.readableEnded);
                await result.completed;
            });
        }

        it('decodes UTF-8 characters split across output chunks', async () => {
            const bytes = Buffer.from('a\u20acb');
            const executor = new ProcessExecutor(createMockVsCode().vscode, createMockSpawn({
                stdoutChunks: [bytes.subarray(0, 2), bytes.subarray(2)],
            }));
            const result = await executor.spawn({ execution: 'background', command: ['func'], streamOutput: true });
            const [stdout, stderr] = await Promise.all([collectAsync(result.stdout), collectAsync(result.stderr)]);
            expect(stdout.join('')).to.equal('a\u20acb');
            expect(stderr).to.deep.equal([]);
            await result.completed;
        });

        it('should throw ProcessError on non-zero exit code', async () => {
            const { vscode: code } = createMockVsCode();
            const spawnFn = createMockSpawn({ exitCode: 1, stderr: 'failure reason' });
            const executor = new ProcessExecutor(code, spawnFn);

            await expect(executor.spawn({
                execution: 'background',
                command: ['test-cmd'],
            })).to.be.rejectedWith(ProcessError, 'failure reason')
                .and.eventually.have.property('code', 1);
        });

        it('should throw ProcessError when terminated by a signal', async () => {
            const { vscode: code } = createMockVsCode();
            const spawnFn = createMockSpawn({ exitCode: null, signalName: 'SIGTERM', stderr: 'killed' });
            const executor = new ProcessExecutor(code, spawnFn);

            await expect(executor.spawn({
                execution: 'background',
                command: ['test-cmd'],
            })).to.be.rejectedWith(ProcessError, 'killed')
                .and.eventually.have.property('signal', 'SIGTERM');
        });

        it('should capture stdout and stderr on the thrown error', async () => {
            const { vscode: code } = createMockVsCode();
            const spawnFn = createMockSpawn({ exitCode: 2, stdout: 'partial', stderr: 'why it failed' });
            const executor = new ProcessExecutor(code, spawnFn);

            const error: ProcessError = await expect(executor.spawn({
                execution: 'background',
                command: ['test-cmd'],
            })).to.be.rejected;

            expect(error.stdout).to.equal('partial');
            expect(error.stderr).to.equal('why it failed');
        });

        it('should preserve the ENOENT code when the executable cannot be resolved', async () => {
            // The executable is resolved before the process starts, so a missing
            // command always surfaces as ENOENT -- including on Windows, where
            // callers (e.g. AzdService) rely on `.code` to detect "not installed".
            const { vscode: code } = createMockVsCode();
            const spawnError = new ProcessError('The executable could not be found.', { code: 'ENOENT' });
            const spawnFn = createMockSpawn({ spawnError });
            const executor = new ProcessExecutor(code, spawnFn);

            const error: Error & { code?: string } = await expect(executor.spawn({
                execution: 'background',
                command: ['test-cmd'],
            })).to.be.rejected;
            expect(error.code).to.equal('ENOENT');
        });

        it('should reject promptly when the process fails to spawn', async () => {
            // Mirrors a spawn-time failure: the process never starts. The
            // rejection must settle promptly, not hang.
            const { vscode: code } = createMockVsCode();
            const spawnFn = createMockSpawn({ emitError: new Error('spawn test-cmd EACCES') });
            const executor = new ProcessExecutor(code, spawnFn);

            const spawnResult = executor.spawn({
                execution: 'background',
                command: ['test-cmd'],
            });

            const timedOut = Symbol('timed-out');
            const outcome = await Promise.race([
                spawnResult.then(() => undefined, (e: unknown) => e),
                delay(2000).then(() => timedOut),
            ]);

            expect(outcome, 'spawn() hung instead of rejecting').to.not.equal(timedOut);
            expect((outcome as Error).message).to.include('EACCES');
        });

        it('should pass the command and args from a CommandLineBuilder', async () => {
            const { vscode: code } = createMockVsCode();
            const spawnFn = createMockSpawn({ stdout: 'ok' });
            const executor = new ProcessExecutor(code, spawnFn);

            await executor.spawn({
                execution: 'background',
                command: command('test-cmd').arg('sub').namedArg('--name', 'value').flagArg('--force'),
            });

            expect(spawnFn.mock.callCount()).to.equal(1);
            const [cmd, args] = spawnFn.mock.calls[0].arguments;
            expect(cmd).to.equal('test-cmd');
            expect(args).to.deep.equal(['sub', '--name', 'value', '--force']);
        });

        for (const pathName of ['PATH', 'Path', 'pAtH']) {
            it(`should inherit ${pathName} when layering the caller env`, async () => {
                mock.property(process, 'env', { [pathName]: 'inherited-path' });
                const { vscode: code } = createMockVsCode();
                const spawnFn = createMockSpawn({ stdout: 'ok' });
                const executor = new ProcessExecutor(code, spawnFn);

                await executor.spawn({
                    execution: 'background',
                    command: ['test-cmd'],
                    env: { CUSTOM_VALUE: 'set-by-caller' }, // eslint-disable-line @typescript-eslint/naming-convention
                });

                // The child environment replaces `process.env` rather than layering
                // onto it, so the executor must merge before spawning.
                const spawnOptions = spawnFn.mock.calls[0].arguments[2]!;
                expect(spawnOptions.env).to.have.property('CUSTOM_VALUE', 'set-by-caller');
                expect(spawnOptions.env).to.have.property(pathName, 'inherited-path');
            });
        }

        it('should replace a differently-cased env override rather than duplicating it', async function () {
            // Windows environment names are case-insensitive, and a spawn whose
            // environment carries two spellings of one name is rejected.
            if (process.platform !== 'win32') {
                this.skip();
            }

            const { vscode: code } = createMockVsCode();
            const spawnFn = createMockSpawn({ stdout: 'ok' });
            const executor = new ProcessExecutor(code, spawnFn);

            await executor.spawn({
                execution: 'background',
                command: ['test-cmd'],
                env: { Path: 'C:\\only-this' },
            });

            const spawnOptions = spawnFn.mock.calls[0].arguments[2]!;
            const pathKeys = Object.keys(spawnOptions.env ?? {}).filter((key) => key.toLowerCase() === 'path');
            expect(pathKeys).to.have.lengthOf(1);
            expect(spawnOptions.env?.[pathKeys[0]]).to.equal('C:\\only-this');
        });

        it('should allow Windows batch files so .cmd shims can be launched', async () => {
            const { vscode: code } = createMockVsCode();
            const spawnFn = createMockSpawn({ stdout: 'ok' });
            const executor = new ProcessExecutor(code, spawnFn);

            await executor.spawn({
                execution: 'background',
                command: ['az', 'account', 'show'],
            });

            const spawnOptions = spawnFn.mock.calls[0].arguments[2]!;
            expect(spawnOptions.allowWindowsBatchFiles).to.equal(true);
        });

        it('should throw CancellationError when the signal is already aborted', async () => {
            const { vscode: code } = createMockVsCode();
            const spawnFn = createMockSpawn({ stdout: 'ok' });
            const executor = new ProcessExecutor(code, spawnFn);

            await expect(executor.spawn({
                execution: 'background',
                command: ['test-cmd'],
            }, AbortSignal.abort())).to.be.rejectedWith(CancellationError);
        });

        it('should throw CancellationError when the process reports an abort', async () => {
            const { vscode: code } = createMockVsCode();
            const spawnFn = createMockSpawn({ emitError: new ProcessError('Aborted', { code: 'ABORT_ERR' }) });
            const executor = new ProcessExecutor(code, spawnFn);

            await expect(executor.spawn({
                execution: 'background',
                command: ['test-cmd'],
            })).to.be.rejectedWith(CancellationError);
        });

        it('should throw when the command vector is empty', async () => {
            const { vscode: code } = createMockVsCode();
            const spawnFn = createMockSpawn();
            const executor = new ProcessExecutor(code, spawnFn);

            await expect(executor.spawn({
                execution: 'background',
                command: [],
            })).to.be.rejectedWith(Error, 'must include at least the executable');
            expect(spawnFn.mock.callCount()).to.equal(0);
        });

        it('should stream JSON lines from stderr', async () => {
            const { vscode: code } = createMockVsCode();
            const spawnFn = createMockSpawn({
                stdout: '{"done":true}',
                stderrLines: ['{"step":1}', '{"step":2}'],
            });
            const executor = new ProcessExecutor(code, spawnFn);

            const result = await executor.spawn<{ done: boolean }>({
                execution: 'background',
                command: ['test-cmd'],
                parseJson: true,
                jsonLines: true,
            });

            const lines: unknown[] = [];
            for await (const line of result.jsonLines) {
                lines.push(line);
            }

            expect(lines).to.deep.equal([{ step: 1 }, { step: 2 }]);

            const completed = await result.completed;
            expect(completed.json).to.deep.equal({ done: true });
            // stderr is streamed live in jsonLines mode, so it is not buffered.
            expect(completed.stderr).to.equal('');
        });

        it('should skip non-JSON lines in JSON lines mode', async () => {
            const { vscode: code } = createMockVsCode();
            const spawnFn = createMockSpawn({
                stdout: '{}',
                stderrLines: ['not json', '{"valid":true}', 'also not json'],
            });
            const executor = new ProcessExecutor(code, spawnFn);

            const result = await executor.spawn({
                execution: 'background',
                command: ['test-cmd'],
                parseJson: true,
                jsonLines: true,
            });

            const lines: unknown[] = [];
            for await (const line of result.jsonLines) {
                lines.push(line);
            }

            expect(lines).to.deep.equal([{ valid: true }]);
        });

        it('reports a JSONL process failure through completion after yielding its progress', async () => {
            const executor = new ProcessExecutor(createMockVsCode().vscode, createMockSpawn({
                stdout: '{}', stderrLines: ['{"step":1}'], exitCode: 2,
            }));
            const result = await executor.spawn({
                execution: 'background', command: ['test-cmd'], parseJson: true, jsonLines: true,
            });
            expect(await collectAsync(result.jsonLines)).to.deep.equal([{ step: 1 }]);
            await expect(result.completed).to.be.rejectedWith(ProcessError).and.eventually.have.property('code', 2);
        });

        it('reports malformed JSON stdout through JSONL completion', async () => {
            const executor = new ProcessExecutor(createMockVsCode().vscode, createMockSpawn({
                stdout: 'not JSON', stderrLines: ['{"step":1}'],
            }));
            const result = await executor.spawn({
                execution: 'background', command: ['test-cmd'], parseJson: true, jsonLines: true,
            });
            expect(await collectAsync(result.jsonLines)).to.deep.equal([{ step: 1 }]);
            await expect(result.completed).to.be.rejectedWith(SyntaxError);
        });
    });

    describe('owned process-tree cancellation', () => {
        afterEach(() => { mock.timers.reset(); mock.restoreAll(); });

        for (const platform of ['win32', 'linux', 'darwin'] as const) {
            for (const owned of [true, false]) {
                it(`uses ${platform} process isolation only for owned launches (${owned})`, async () => {
                    mock.property(process, 'platform', platform);
                    const s = createMockProcessExecutor(createMockVsCode().vscode);
                    await s.executor.spawn({ execution: 'background', command: ['owned'], killTreeOnCancel: owned });
                    expect(s.spawn.mock.calls[0].arguments[2]?.detached).to.equal(owned && platform !== 'win32');
                });
            }
        }

        for (const code of [undefined, 'ESRCH', 'EPERM']) {
            it(`signals the owned POSIX group and handles ${code ?? 'successful termination'}`, async () => {
                mock.property(process, 'platform', 'linux');
                const spawn = createMockSpawn({ keepAlive: true, pid: 1234 });
                const kill = mock.method(process, 'kill', () => {
                    if (code) { throw Object.assign(new Error('Group termination failed'), { code }); }
                    return true;
                });
                const executor = new ProcessExecutor(createMockVsCode().vscode, spawn);
                const abort = new AbortController();
                const running = executor.spawn({ execution: 'background', command: ['owned'], killTreeOnCancel: true }, abort.signal);
                const rejected = code === 'EPERM'
                    ? expect(running).to.be.rejectedWith('Group termination failed')
                    : expect(running).to.be.rejectedWith(CancellationError);
                abort.abort();
                await waitFor(() => kill.mock.callCount() === 1);
                spawn.mock.calls[0].result?.emit('close', 0, null);
                await rejected;
                expect(kill.mock.calls[0].arguments).to.deep.equal([-1234, 'SIGKILL']);
            });
        }

        it('signals the POSIX group after its leader exits while a worker still holds the pipes', async () => {
            mock.property(process, 'platform', 'linux');
            const spawn = createMockSpawn({ keepAlive: true, keepStreamsOpen: true, pid: 1234 });
            const kill = mock.method(process, 'kill', () => true);
            const executor = new ProcessExecutor(createMockVsCode().vscode, spawn);
            const abort = new AbortController();
            const running = executor.spawn({ execution: 'background', command: ['owned'], killTreeOnCancel: true }, abort.signal);
            const rejected = expect(running).to.be.rejectedWith(CancellationError);
            const child = spawn.mock.calls[0].result;
            if (!child) { throw new Error('Expected the owned child process.'); }
            mock.property(child, 'exitCode', 0);
            child.emit('exit', 0, null);
            abort.abort();
            await waitFor(() => kill.mock.callCount() === 1);
            child.stdout?.push(null);
            child.stderr?.push(null);
            child.emit('close', 0, null);
            await rejected;
            expect(kill.mock.calls[0].arguments).to.deep.equal([-1234, 'SIGKILL']);
        });

        for (const exitedBy of ['exitCode', 'signalCode'] as const) {
            it(`rejects Windows cancellation and releases waiting output when pipes stay open after the launcher exits by ${exitedBy}`, async () => {
                mock.property(process, 'platform', 'win32');
                mock.timers.enable({ apis: ['setTimeout'] });
                const s = createMockProcessExecutor(createMockVsCode().vscode, { keepAlive: true, keepStreamsOpen: true });
                const abort = new AbortController();
                const running = await s.executor.spawn({
                    execution: 'background', command: ['owned'], streamOutput: true, killTreeOnCancel: true,
                }, abort.signal);
                const output = Promise.all([collectAsync(running.stdout), collectAsync(running.stderr)]);
                const rejected = expect(running.completed).to.be.rejectedWith('Cannot terminate the process tree after its launcher has exited on Windows.');
                const child = s.spawn.mock.calls[0].result;
                if (!child) { throw new Error('Expected the owned child process.'); }
                mock.property(child, exitedBy, exitedBy === 'exitCode' ? 0 : 'SIGTERM');
                child.emit('exit', child.exitCode, child.signalCode);
                abort.abort();
                mock.timers.tick(WindowsLauncherExitGraceMs);
                try {
                    await rejected;
                    expect(await output).to.deep.equal([[], []]);
                    expect(s.terminateTree.mock.callCount()).to.equal(0);
                } finally {
                    child.stdout?.push(null);
                    child.stderr?.push(null);
                    child.emit('close', child.exitCode, child.signalCode);
                }
            });
        }

        it('treats Windows cancellation as clean when the exiting launcher closes within the grace period', async () => {
            mock.property(process, 'platform', 'win32');
            mock.timers.enable({ apis: ['setTimeout'] });
            const s = createMockProcessExecutor(createMockVsCode().vscode, { keepAlive: true, keepStreamsOpen: true });
            const abort = new AbortController();
            const running = s.executor.spawn({ execution: 'background', command: ['owned'], killTreeOnCancel: true }, abort.signal);
            const rejected = expect(running).to.be.rejectedWith(CancellationError);
            const child = s.spawn.mock.calls[0].result;
            if (!child) { throw new Error('Expected the owned child process.'); }
            mock.property(child, 'exitCode', 1);
            child.emit('exit', 1, null);
            abort.abort();
            child.stdout?.push(null);
            child.stderr?.push(null);
            child.emit('close', 1, null);
            await rejected;
            // A grace timer left running would reject after the process is already gone.
            mock.timers.tick(WindowsLauncherExitGraceMs);
            expect(s.terminateTree.mock.callCount()).to.equal(0);
        });

        it('ends a waiting output generator when tree termination fails before the child closes', async () => {
            const s = createMockProcessExecutor(createMockVsCode().vscode, { keepAlive: true, keepStreamsOpen: true });
            s.terminateTree.mock.mockImplementation(() => Promise.reject(new Error('termination failed')));
            const abort = new AbortController();
            const running = await s.executor.spawn({
                execution: 'background', command: ['owned'], streamOutput: true, killTreeOnCancel: true,
            }, abort.signal);
            const output = Promise.all([collectAsync(running.stdout), collectAsync(running.stderr)]);
            const rejected = expect(running.completed).to.be.rejectedWith('termination failed');
            abort.abort();
            try {
                await rejected;
                expect(await output).to.deep.equal([[], []]);
            } finally {
                s.spawn.mock.calls[0].result?.emit('close', 0, null);
            }
        });

        it('waits for descendant termination before completing cancellation', async () => {
            const m = createMockVsCode();
            const s = createMockProcessExecutor(m.vscode, { keepAlive: true });
            const kill = mock.method(s.executor, 'killProcessTree');
            const terminated = Promise.withResolvers<undefined>();
            const settled = mock.fn();
            s.terminateTree.mock.mockImplementation(() => {
                s.spawn.mock.calls[0].result?.emit('close', 0, null);
                return terminated.promise;
            });
            const abort = new AbortController();
            const process = s.executor.spawn({ execution: 'background', command: ['owned'], killTreeOnCancel: true }, abort.signal);
            void process.then(settled, settled);
            abort.abort();
            await delay(0);
            expect(settled.mock.callCount()).to.equal(0);
            terminated.resolve(undefined);
            await expect(process).to.be.rejectedWith(CancellationError);
            expect(s.terminateTree.mock.calls[0].arguments[0]).to.equal(s.spawn.mock.calls[0].result?.pid);
            expect(kill.mock.calls[0].arguments).to.deep.equal([s.spawn.mock.calls[0].result?.pid]);
        });

        for (const failure of ['throw', 'reject']) {
            it(`surfaces a tree-termination ${failure} instead of reporting ordinary cancellation`, async () => {
                const s = createMockProcessExecutor(createMockVsCode().vscode, { keepAlive: true });
                s.terminateTree.mock.mockImplementation(() => {
                    if (failure === 'throw') { throw new Error('termination failed'); }
                    return Promise.reject(new Error('termination failed'));
                });
                const abort = new AbortController();
                const process = s.executor.spawn({ execution: 'background', command: ['owned'], killTreeOnCancel: true }, abort.signal);
                const rejected = expect(process).to.be.rejectedWith('termination failed');
                abort.abort();
                try { await rejected; }
                finally { s.spawn.mock.calls[0].result?.emit('close', 0, null); }
            });
        }

        it('does not spawn an owned process when cancellation precedes startup', async () => {
            const s = createMockProcessExecutor(createMockVsCode().vscode);
            const abort = new AbortController();
            abort.abort();
            await expect(s.executor.spawn({ execution: 'background', command: ['owned'], killTreeOnCancel: true }, abort.signal))
                .to.be.rejectedWith(CancellationError);
            expect(s.spawn.mock.callCount()).to.equal(0);
        });
    });

    describe('owned process-tree termination (integration)', () => {
        it('stops a real child worker as well as its directly spawned parent', async () => {
            const executor = new ProcessExecutor(createMockVsCode().vscode);
            const abort = new AbortController();
            const running = await executor.spawn({
                execution: 'background', killTreeOnCancel: true, streamOutput: true,
                command: [process.execPath, '-e', `const {spawn}=require('node:child_process'); const worker=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); console.log(worker.pid); setInterval(()=>{},1000);`],
            }, abort.signal);
            const rejected = expect(running.completed).to.be.rejectedWith(CancellationError);
            try {
                const stderr = collectAsync(running.stderr);
                const first = await running.stdout.next();
                if (first.done) { throw new Error('Expected the owned worker PID on stdout.'); }
                const pid = Number(first.value.trim());
                expect(pid).to.be.greaterThan(0);
                const remainder = collectAsync(running.stdout);
                abort.abort();
                await rejected;
                expect(await remainder).to.deep.equal([]);
                expect(await stderr).to.deep.equal([]);
                expect(() => process.kill(pid, 0)).to.throw();
            } finally {
                abort.abort();
                await Promise.all([running.stdout.return(undefined), running.stderr.return(undefined)]);
                await running.completed.catch(() => undefined);
            }
        });
    });

    describe('foreground execution', () => {
        const getTaskExecution = getMockTaskExecution;

        it('should terminate the task when cancellation precedes startup', async () => {
            const m = createMockVsCode();
            const executor = new ProcessExecutor(m.vscode);
            const controller = new AbortController();
            controller.abort();
            const terminate = mock.fn();
            m.tasks.executeTask.mock.mockImplementation(task => Promise.resolve({ task, terminate }));
            const promise = executor.spawn({
                execution: 'foreground',
                command: [process.execPath],
                name: 'Cancelled Task',
            }, controller.signal);

            await expect(promise).to.be.rejectedWith(CancellationError);
            expect(m.tasks.executeTask.mock.callCount()).to.equal(1);
            expect(terminate.mock.callCount()).to.equal(1);
        });

        it('should report an unknown task exit code as a failure', async () => {
            const m = createMockVsCode();
            const executor = new ProcessExecutor(m.vscode);
            const promise = executor.spawn({
                execution: 'foreground',
                command: [process.execPath],
                name: 'Interrupted Task',
            });
            const taskExecution = await getTaskExecution(m);
            m.taskProcessEndEmitter.fire({ execution: taskExecution, exitCode: undefined });

            await expect(promise).to.be.rejectedWith(Error, "'Interrupted Task' failed with exit code -1");
        });

        it('should create a task and resolve on exit code 0', async () => {
            const m = createMockVsCode();
            const executor = new ProcessExecutor(m.vscode);

            const promise = executor.spawn({
                execution: 'foreground',
                command: [process.execPath, '--version'],
                name: 'Test Task',
            });

            const taskExecution = await getTaskExecution(m);

            m.taskProcessEndEmitter.fire({
                execution: taskExecution,
                exitCode: 0,
            });

            await promise;
        });

        it('should reject with an Error on non-zero exit code', async () => {
            const m = createMockVsCode();
            const executor = new ProcessExecutor(m.vscode);

            const promise = executor.spawn({
                execution: 'foreground',
                command: [process.execPath],
                name: 'Failing Task',
            });

            const taskExecution = await getTaskExecution(m);

            m.taskProcessEndEmitter.fire({
                execution: taskExecution,
                exitCode: 42,
            });

            const error: Error = await expect(promise).to.be.rejectedWith(Error);
            expect(error.message).to.include('42');
            expect(error.message).to.include('Failing Task');
        });

        it('should reject with CancellationError when cancelled', async () => {
            const m = createMockVsCode();
            const executor = new ProcessExecutor(m.vscode);

            const emitter = new EventEmitter<void>();
            const token = {
                isCancellationRequested: false,
                onCancellationRequested: emitter.event,
            };

            const promise = executor.spawn({
                execution: 'foreground',
                command: [process.execPath],
                name: 'Cancelable Task',
            }, token);

            const taskExecution = await getTaskExecution(m);

            // Cancel
            emitter.fire();

            await expect(promise).to.be.rejectedWith(CancellationError);

            // Verify terminate was called
            const terminate = (taskExecution as unknown as { terminate: Mock<() => void> }).terminate;
            expect(terminate.mock.callCount()).to.equal(1);
        });

        it('should ignore events from other task executions', async () => {
            const m = createMockVsCode();
            const executor = new ProcessExecutor(m.vscode);

            const promise = executor.spawn({
                execution: 'foreground',
                command: [process.execPath],
                name: 'My Task',
            });

            const taskExecution = await getTaskExecution(m);

            // Fire event for a different execution -- should be ignored
            const otherExecution = { task: {}, terminate: mock.fn() } as unknown as vscode.TaskExecution;
            m.taskProcessEndEmitter.fire({ execution: otherExecution, exitCode: 1 });

            // Now fire for the real execution
            m.taskProcessEndEmitter.fire({ execution: taskExecution, exitCode: 0 });

            await promise; // Should resolve without error
        });

        it('should set task options for alwaysRunNew and focus', async () => {
            const m = createMockVsCode();
            const executor = new ProcessExecutor(m.vscode);

            const promise = executor.spawn({
                execution: 'foreground',
                command: [process.execPath],
                name: 'Fancy Task',
                alwaysRunNew: true,
                focus: true,
                source: 'mySource',
            });

            await delay(0);
            const task = m.tasks.executeTask.mock.calls[0].arguments[0];

            expect(task.definition.idRandomizer).to.be.a('number');
            expect(task.presentationOptions.focus).to.be.true;
            expect(task.source).to.equal('mySource');

            const taskExecution = await getTaskExecution(m);
            m.taskProcessEndEmitter.fire({ execution: taskExecution, exitCode: 0 });
            await promise;
        });

        it('should use workspace folder as scope when provided', async () => {
            const m = createMockVsCode();
            const executor = new ProcessExecutor(m.vscode);

            const folder = { uri: { fsPath: '/test' }, name: 'test', index: 0 } as vscode.WorkspaceFolder;

            const promise = executor.spawn({
                execution: 'foreground',
                command: [process.execPath],
                name: 'Scoped Task',
                workspaceFolder: folder,
            });

            await delay(0);
            const task = m.tasks.executeTask.mock.calls[0].arguments[0];

            expect(task.scope).to.equal(folder);

            const taskExecution = await getTaskExecution(m);
            m.taskProcessEndEmitter.fire({ execution: taskExecution, exitCode: 0 });
            await promise;
        });

        it('should default source to process and scope to TaskScope.Workspace', async () => {
            const m = createMockVsCode();
            const executor = new ProcessExecutor(m.vscode);

            const promise = executor.spawn({
                execution: 'foreground',
                command: [process.execPath],
                name: 'Default Task',
            });

            await delay(0);
            const task = m.tasks.executeTask.mock.calls[0].arguments[0];

            expect(task.source).to.equal('process');
            expect(task.scope).to.equal(2); // TaskScope.Workspace

            const taskExecution = await getTaskExecution(m);
            m.taskProcessEndEmitter.fire({ execution: taskExecution, exitCode: 0 });
            await promise;
        });
    });

    describe('killProcessTree', () => {
        afterEach(() => { mock.restoreAll(); });

        it('forwards an owned PID and waits for termination', async () => {
            const terminated = Promise.withResolvers<undefined>();
            const terminate = mock.fn((_pid: number) => terminated.promise);
            const executor = new ProcessExecutor(createMockVsCode().vscode, createMockSpawn(), undefined, terminate);
            const settled = mock.fn();
            const killing = executor.killProcessTree(1234);
            void killing.then(settled, settled);
            await delay(0);
            expect(terminate.mock.calls[0].arguments).to.deep.equal([1234]);
            expect(settled.mock.callCount()).to.equal(0);
            terminated.resolve(undefined);
            await killing;
        });

        it('propagates termination failure', async () => {
            const terminate = mock.fn(() => Promise.reject(new Error('Termination denied')));
            const executor = new ProcessExecutor(createMockVsCode().vscode, createMockSpawn(), undefined, terminate);
            await expect(executor.killProcessTree(1234)).to.be.rejectedWith('Termination denied');
        });

        for (const pid of [0, 1, -1, -1234, 2.5, NaN, Infinity, 0x80000000]) {
            it(`rejects unsafe process ID ${pid} before invoking termination`, async () => {
                const terminate = mock.fn(() => Promise.resolve());
                const executor = new ProcessExecutor(createMockVsCode().vscode, createMockSpawn(), undefined, terminate);
                await expect(executor.killProcessTree(pid)).to.be.rejectedWith(RangeError);
                expect(terminate.mock.callCount()).to.equal(0);
            });
        }
    });

    describe('resolveExecutable', () => {
        it('should resolve commands with Windows batch files enabled', () => {
            const { vscode: code } = createMockVsCode();
            const executablePath = path.resolve('tool.cmd');
            const resolveExecutableFn = mock.fn<ResolveExecutableFn>(() => executablePath);
            const executor = new ProcessExecutor(code, createMockSpawn(), resolveExecutableFn);

            const result = executor.resolveExecutable('tool');

            expect(result).to.equal(executablePath);
            expect(resolveExecutableFn.mock.calls[0].arguments).to.deep.equal([
                'tool',
                { allowWindowsBatchFiles: true },
            ]);
        });

        it('should return undefined when the resolver does not find the command', () => {
            const { vscode: code } = createMockVsCode();
            const resolveExecutableFn = mock.fn<ResolveExecutableFn>(() => undefined);
            const executor = new ProcessExecutor(code, createMockSpawn(), resolveExecutableFn);

            const result = executor.resolveExecutable('missing');

            expect(result).to.be.undefined;
        });
    });
});

describe('ProcessExecutor (integration)', () => {
    // Strip NODE_OPTIONS so spawned Node children don't inherit the test
    // runner's --inspect flags. Otherwise, when the tests run under the VS
    // Code debugger, every child prints 'Debugger attached.' to stderr at
    // startup and 'Waiting for the debugger to disconnect...' at exit,
    // which pollutes the captured stdout/stderr that these tests assert on.
    const env: Record<string, string> = { NODE_OPTIONS: '' }; // eslint-disable-line @typescript-eslint/naming-convention

    // Builds the spawn options needed to evaluate a snippet of JS in a child
    // Node process without depending on shell quoting. The snippet is passed
    // through an environment variable and evaluated with
    // `eval(process.env.NODE_EVAL_SOURCE)`, keeping the command line free of
    // spaces and double quotes. Spread the result into the `spawn` options object.
    function evalNode(source: string): { command: CommandLineArgs; env: Record<string, string> } {
        return {
            command: [process.execPath, '-e', 'eval(process.env.NODE_EVAL_SOURCE)'],
            env: { ...env, NODE_EVAL_SOURCE: source }, // eslint-disable-line @typescript-eslint/naming-convention
        };
    }

    // Builds spawn options for a child that echoes its own argument vector
    // (everything after the executable and the `-e` script) back as JSON on
    // stdout. Used to assert that arguments survive the round-trip to the OS
    // verbatim, without any shell interpretation or quoting corruption.
    function argvEcho(args: readonly string[]): { command: CommandLineArgs; env: Record<string, string> } {
        return {
            command: [process.execPath, '-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', ...args],
            env,
        };
    }

    describe('background execution', () => {
        it('should capture stdout and stderr', async () => {
            const { vscode: code } = createMockVsCode();
            const executor = new ProcessExecutor(code);

            const result = await executor.spawn({
                execution: 'background',
                ...evalNode('process.stdout.write("out"); process.stderr.write("err");'),
            });

            expect(result.stdout).to.equal('out');
            expect(result.stderr).to.equal('err');
        });

        it('should parse stdout as JSON when parseJson is true', async () => {
            const { vscode: code } = createMockVsCode();
            const executor = new ProcessExecutor(code);

            const result = await executor.spawn<{ key: string }>({
                execution: 'background',
                ...evalNode('process.stdout.write(JSON.stringify({ key: "value" }));'),
                parseJson: true,
            });

            expect(result.json).to.deep.equal({ key: 'value' });
            expect(result.stdout).to.equal('{"key":"value"}');
        });

        it('should throw ProcessError on non-zero exit code', async () => {
            const { vscode: code } = createMockVsCode();
            const executor = new ProcessExecutor(code);

            await expect(executor.spawn({
                execution: 'background',
                ...evalNode('process.stderr.write("failure reason"); process.exit(1);'),
            })).to.be.rejectedWith(ProcessError, 'failure reason');
        });

        it('should throw CancellationError when cancelled', async () => {
            const { vscode: code } = createMockVsCode();
            const executor = new ProcessExecutor(code);

            const emitter = new EventEmitter<void>();
            const token = {
                isCancellationRequested: false,
                onCancellationRequested: emitter.event,
            };

            const promise = executor.spawn({
                execution: 'background',
                ...evalNode('setTimeout(() => {}, 30000);'),
            }, token);

            await delay(50);
            token.isCancellationRequested = true;
            emitter.fire();

            await expect(promise).to.be.rejectedWith(CancellationError);
        });

        it('should stream JSON lines from stderr', async () => {
            const { vscode: code } = createMockVsCode();
            const executor = new ProcessExecutor(code);

            const f = [
                'process.stderr.write(JSON.stringify({ step: 1 }) + "\\n");',
                'process.stderr.write(JSON.stringify({ step: 2 }) + "\\n");',
                'process.stdout.write(JSON.stringify({ done: true }));',
            ].join('\n');

            const result = await executor.spawn<{ done: boolean }>({
                execution: 'background',
                ...evalNode(f),
                parseJson: true,
                jsonLines: true,
            });

            const lines: unknown[] = [];
            for await (const line of result.jsonLines) {
                lines.push(line);
            }

            expect(lines).to.deep.equal([{ step: 1 }, { step: 2 }]);

            const completed = await result.completed;
            expect(completed.json).to.deep.equal({ done: true });
            // stderr is streamed live in jsonLines mode, so it is not buffered.
            expect(completed.stderr).to.equal('');
        });

        it('should skip non-JSON lines in JSON lines mode', async () => {
            const { vscode: code } = createMockVsCode();
            const executor = new ProcessExecutor(code);

            const f = [
                'process.stderr.write("not json\\n");',
                'process.stderr.write(JSON.stringify({ valid: true }) + "\\n");',
                'process.stderr.write("also not json\\n");',
                'process.stdout.write("{}");',
            ].join('\n');

            const result = await executor.spawn({
                execution: 'background',
                ...evalNode(f),
                parseJson: true,
                jsonLines: true,
            });

            const lines: unknown[] = [];
            for await (const line of result.jsonLines) {
                lines.push(line);
            }

            expect(lines).to.deep.equal([{ valid: true }]);
        });
    });

    describe('hard cases', () => {
        it('streams both channels beyond the OS pipe buffer without truncation or deadlock', async () => {
            const size = 1024 * 1024;
            const executor = new ProcessExecutor(createMockVsCode().vscode);
            const result = await executor.spawn({
                execution: 'background', streamOutput: true,
                command: [process.execPath, '-e', `process.stdout.write('o'.repeat(${size})); process.stderr.write('e'.repeat(${size}));`],
            });
            const [stdout, stderr] = await Promise.all([collectAsync(result.stdout), collectAsync(result.stderr)]);
            expect(stdout.join('')).to.equal('o'.repeat(size));
            expect(stderr.join('')).to.equal('e'.repeat(size));
            await result.completed;
        });

        it('lets a large-output process finish after its output generator is closed early', async () => {
            const executor = new ProcessExecutor(createMockVsCode().vscode);
            const result = await executor.spawn({
                execution: 'background', streamOutput: true,
                command: [process.execPath, '-e', `process.stdout.write('o'.repeat(1024 * 1024)); process.stderr.write('e'.repeat(1024 * 1024));`],
            });
            for await (const text of result.stdout) {
                expect(text.length).to.be.greaterThan(0);
                break;
            }
            expect((await collectAsync(result.stderr)).join('')).to.equal('e'.repeat(1024 * 1024));
            await result.completed;
        });

        for (const method of ['return', 'throw'] as const) {
            it(`lets a large-output process finish after ${method} before either channel starts`, async () => {
                const controller = new AbortController();
                const executor = new ProcessExecutor(createMockVsCode().vscode);
                const result = await executor.spawn({
                    execution: 'background', streamOutput: true,
                    ...evalNode(`process.stdout.write('o'.repeat(1024 * 1024)); process.stderr.write('e'.repeat(1024 * 1024));`),
                }, controller.signal);
                try {
                    for (const channel of [result.stdout, result.stderr]) {
                        if (method === 'return') {
                            await channel.return(undefined);
                        } else {
                            await expect(channel.throw(new Error('Consumer stopped.'))).to.be.rejectedWith('Consumer stopped.');
                        }
                    }
                    await result.completed;
                } finally {
                    controller.abort();
                }
            });
        }

        it('should pass arguments verbatim without shell interpretation or quoting corruption', async () => {
            const { vscode: code } = createMockVsCode();
            const executor = new ProcessExecutor(code);

            // A grab-bag of arguments that shells (or naive quoting) would
            // mangle: spaces, embedded quotes, backslashes (including a
            // trailing one -- the classic Windows CommandLineToArgvW pitfall),
            // shell metacharacters, and variable-expansion syntax that must
            // NOT be expanded since no shell is involved.
            const args = [
                'plain',
                'with spaces',
                'embedded"double"quotes',
                "embedded'single'quotes",
                'back\\slash',
                'trailing\\',
                'meta&|;<>^()chars',
                '%PATH%', // must stay literal (no cmd.exe expansion)
                '$HOME', // must stay literal (no POSIX shell expansion)
                'tab\tinside',
                'a=b',
            ];

            const result = await executor.spawn({
                execution: 'background',
                ...argvEcho(args),
            });

            expect(JSON.parse(result.stdout)).to.deep.equal(args);
        });

        it('should capture large stdout without truncation or deadlock', async function () {
            this.timeout(20000);
            const { vscode: code } = createMockVsCode();
            const executor = new ProcessExecutor(code);

            // 5 MB is far beyond a typical ~64 KB OS pipe buffer, so the child
            // will block on write() unless the executor drains stdout
            // concurrently. A regression here manifests as a hang (timeout).
            const size = 5 * 1024 * 1024;
            const result = await executor.spawn({
                execution: 'background',
                ...evalNode(`process.stdout.write('x'.repeat(${size}));`),
            });

            expect(result.stdout.length).to.equal(size);
        });

        it('should stream a large number of JSON lines from stderr in order', async function () {
            this.timeout(20000);
            const { vscode: code } = createMockVsCode();
            const executor = new ProcessExecutor(code);

            const count = 2000;
            const source = [
                `for (let i = 0; i < ${count}; i++) {`,
                `    process.stderr.write(JSON.stringify({ i }) + '\\n');`,
                `}`,
                `process.stdout.write(JSON.stringify({ done: true }));`,
            ].join('\n');

            const result = await executor.spawn<{ done: boolean }>({
                execution: 'background',
                ...evalNode(source),
                parseJson: true,
                jsonLines: true,
            });

            const seen: number[] = [];
            for await (const line of result.jsonLines) {
                seen.push((line as { i: number }).i);
            }

            expect(seen.length).to.equal(count);
            // Strict ordering: line N carries { i: N }.
            expect(seen.every((value, index) => value === index)).to.be.true;

            const completed = await result.completed;
            expect(completed.json).to.deep.equal({ done: true });
            expect(completed.stderr).to.equal('');
        });

        it('should stream JSON lines while stdout exceeds the OS pipe buffer', async function () {
            this.timeout(20000);
            const { vscode: code } = createMockVsCode();
            const executor = new ProcessExecutor(code);

            // The child fills its stdout pipe before writing a single stderr
            // line, so it blocks in write() unless stdout is drained
            // concurrently. Because the caller drives stderr consumption, a
            // regression deadlocks instead of merely stalling: no stderr is
            // emitted, so the loop below never ends and never reaches
            // `completed`. It manifests as a hang, not a failed assertion.
            const size = 5 * 1024 * 1024;
            const source = [
                `process.stdout.write(JSON.stringify({ pad: 'x'.repeat(${size}) }));`,
                `process.stderr.write(JSON.stringify({ i: 0 }) + '\\n');`,
            ].join('\n');

            const result = await executor.spawn<{ pad: string }>({
                execution: 'background',
                ...evalNode(source),
                parseJson: true,
                jsonLines: true,
            });

            const seen: unknown[] = [];
            for await (const line of result.jsonLines) {
                seen.push(line);
            }

            expect(seen).to.deep.equal([{ i: 0 }]);

            const completed = await result.completed;
            expect(completed.json.pad.length).to.equal(size);
        });

        it('should let the process finish when the caller stops reading JSON lines early', async function () {
            this.timeout(20000);
            const { vscode: code } = createMockVsCode();
            const executor = new ProcessExecutor(code);

            // Far more stderr than the OS pipe holds, so the child blocks on
            // write() the moment the stream stops being read. Breaking out of
            // the loop must release it rather than wedge it: a regression here
            // hangs, because a blocked child never closes and `completed` never
            // settles.
            const source = [
                `const line = JSON.stringify({ i: 0 }) + '\\n';`,
                `for (let i = 0; i < 200000; i++) { process.stderr.write(line); }`,
                `process.stdout.write(JSON.stringify({ done: true }));`,
            ].join('\n');

            const result = await executor.spawn<{ done: boolean }>({
                execution: 'background',
                ...evalNode(source),
                parseJson: true,
                jsonLines: true,
            });

            for await (const line of result.jsonLines) {
                expect(line).to.deep.equal({ i: 0 });
                break;
            }

            // The child still exits normally, so its result stays observable.
            const completed = await result.completed;
            expect(completed.json).to.deep.equal({ done: true });
        });

        it('should reject completed with CancellationError when cancelled mid-stream', async () => {
            const { vscode: code } = createMockVsCode();
            const executor = new ProcessExecutor(code);

            const emitter = new EventEmitter<void>();
            const token = {
                isCancellationRequested: false,
                onCancellationRequested: emitter.event,
            };

            // Emit one line, then hang so the process stays alive until the
            // cancellation tears it down.
            const source = [
                `process.stderr.write(JSON.stringify({ step: 1 }) + '\\n');`,
                `setTimeout(() => {}, 30000);`,
            ].join('\n');

            const result = await executor.spawn({
                execution: 'background',
                ...evalNode(source),
                parseJson: true,
                jsonLines: true,
            }, token);

            // Drain concurrently. The line iterator ends (rather than hanging)
            // once the process is killed, so this settles after cancellation.
            const drained = (async () => {
                const out: unknown[] = [];
                for await (const line of result.jsonLines) {
                    out.push(line);
                }
                return out;
            })();

            await delay(100);
            token.isCancellationRequested = true;
            emitter.fire();

            await expect(result.completed).to.be.rejectedWith(CancellationError);

            // Must not hang: the live stream terminates when the child dies.
            await drained;
        });
    });

    describe('isOnPath', () => {
        it('should return true for a command that exists', () => {
            const { vscode: code } = createMockVsCode();
            const executor = new ProcessExecutor(code);

            // node is always on PATH in this test environment
            const result = executor.isOnPath('node');

            expect(result).to.be.true;
        });

        it('should return false for a command that does not exist', () => {
            const { vscode: code } = createMockVsCode();
            const executor = new ProcessExecutor(code);

            const result = executor.isOnPath('definitely-not-a-real-command-xyz');

            expect(result).to.be.false;
        });
    });

    describe('executable resolution', () => {
        it('should not execute a same-named binary from the working directory', async function () {
            // On Windows a shell searches the working directory before PATH, so
            // a planted binary could otherwise hijack a bare command name.
            if (process.platform !== 'win32') {
                this.skip();
            }

            const { vscode: code } = createMockVsCode();
            const executor = new ProcessExecutor(code);

            const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'process-executor-'));
            try {
                await fs.writeFile(path.join(directory, 'node.cmd'), '@echo off\r\necho hijacked\r\n');

                const result = await executor.spawn({
                    execution: 'background',
                    command: ['node', '--version'],
                    cwd: Uri.file(directory),
                    env,
                });

                expect(result.stdout.trim()).to.equal(process.version);
            } finally {
                await fs.rm(directory, { recursive: true, force: true });
            }
        });
    });
});
