/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProcessError } from '@azure/core-process';
import { ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { mock, type Mock } from 'node:test';
import type * as vscode from 'vscode';
import { URI as Uri } from 'vscode-uri';
import { command, type CommandLineArgs } from '../../src/base/CommandLineBuilder';
import { delay } from '../../src/base/delay';
import { ProcessExecutor, type ResolveExecutableFn, type SpawnFn } from '../../src/base/IProcessExecutor';
import { CancellationError } from '../../src/vscode/CancellationError';
import { EventEmitter } from '../../src/vscode/EventEmitter';
import { createMockVsCode } from '../vscode/MockVsCode';

/** Wraps a list of lines as a readable stream, mimicking a child's stdio. */
function lineStream(lines: readonly string[]): Readable {
    return Readable.from(lines.map((line) => `${line}\n`));
}

/**
 * Creates a mock {@linkcode SpawnFn} returning a fake {@linkcode ChildProcess}:
 * `stdout`/`stderr` readables plus a deferred `'close'` (or `'error'`) event.
 *
 * @param options - `exitCode` defaults to `0`. When `spawnError` is set the
 *   factory throws it synchronously, mimicking a command that cannot be
 *   resolved. When `emitError` is set the child emits it as an `'error'` event.
 */
function createMockSpawn(options?: {
    stdout?: string;
    stderr?: string;
    stderrLines?: readonly string[];
    exitCode?: number | null;
    signalName?: NodeJS.Signals | null;
    spawnError?: Error;
    emitError?: Error;
}): Mock<SpawnFn> {
    const { stdout = '', stderr = '', stderrLines, exitCode = 0, signalName = null, spawnError, emitError } = options ?? {};

    return mock.fn<SpawnFn>((): ChildProcess => {
        if (spawnError) {
            throw spawnError;
        }

        const child = new ChildProcess();
        Object.defineProperties(child, {
            stdout: { value: Readable.from(stdout ? [stdout] : []) },
            stderr: { value: stderrLines ? lineStream(stderrLines) : Readable.from(stderr ? [stderr] : []) },
        });

        // Let the caller attach listeners before the process "finishes".
        setImmediate(() => {
            if (emitError) {
                child.emit('error', emitError);
            } else {
                child.emit('close', exitCode, signalName);
            }
        });

        return child;
    });
}

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
            const onOutput = mock.fn<(text: string, stream: 'stdout' | 'stderr') => void>();
            const result = await executor.spawn({
                execution: 'background', command: ['func', 'host', 'start'], onOutput,
            });

            expect(onOutput.mock.calls.map(call => call.arguments)).to.have.deep.members([
                ['host ready', 'stdout'], ['worker message', 'stderr'],
            ]);
            expect(result).to.deep.equal({ stdout: '', stderr: '' });
        });

        it('reports process failure while streaming output', async () => {
            const { vscode: code } = createMockVsCode();
            const executor = new ProcessExecutor(code, createMockSpawn({ stderr: 'host failure', exitCode: 2 }));
            const onOutput = mock.fn<(text: string, stream: 'stdout' | 'stderr') => void>();
            const error: ProcessError = await expect(executor.spawn({
                execution: 'background', command: ['func'], onOutput,
            })).to.be.rejected;
            expect(error.code).to.equal(2);
            expect(onOutput.mock.calls[0].arguments).to.deep.equal(['host failure', 'stderr']);
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
    });

    describe('foreground execution', () => {
        async function getTaskExecution(m: ReturnType<typeof createMockVsCode>): Promise<vscode.TaskExecution> {
            // Yield to let spawn's async internals call executeTask
            await delay(0);
            expect(m.tasks.executeTask.mock.callCount()).to.equal(1);
            return m.tasks.executeTask.mock.calls[0].result as Promise<vscode.TaskExecution>;
        }

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
