/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { default as spawn, type Result as SpawnResult, type Subprocess } from 'nano-spawn';
import { mock, type Mock } from 'node:test';
import type * as vscode from 'vscode';
import { command } from '../../src/base/CommandLineBuilder';
import { delay } from '../../src/base/delay';
import { ChildProcessError, ProcessExecutor, isChildProcessError, type SpawnFn } from '../../src/base/IProcessExecutor';
import { CancellationError } from '../../src/vscode/CancellationError';
import { EventEmitter } from '../../src/vscode/EventEmitter';
import { createMockVsCode } from '../vscode/MockVsCode';

// Keep the real default export referenced so its type stays exercised.
void spawn;

/** Builds a nano-spawn {@linkcode SpawnResult} with the fields the executor reads. */
function makeResult(command: string, stdout: string, stderr: string): SpawnResult {
    return {
        stdout,
        stderr,
        output: [stdout, stderr].filter(Boolean).join('\n'),
        command,
        durationMs: 0,
    };
}

/** Wraps a list of lines as an async iterable, mimicking nano-spawn's line streams. */
function asyncLines(lines: readonly string[]): AsyncIterable<string> {
    return {
        // eslint-disable-next-line @typescript-eslint/require-await
        async *[Symbol.asyncIterator](): AsyncGenerator<string> {
            for (const line of lines) {
                yield line;
            }
        },
    };
}

/**
 * Builds a fake nano-spawn `SubprocessError`: a plain {@linkcode Error} branded
 * with `name === 'SubprocessError'` plus the fields the executor inspects.
 */
function makeSubprocessError(opts: {
    message?: string;
    exitCode?: number;
    signalName?: string;
    isCanceled?: boolean;
    stderr?: string;
    cause?: unknown;
}): Error {
    const e = new Error(opts.message ?? 'Command failed');
    e.name = 'SubprocessError';
    Object.assign(e, {
        exitCode: opts.exitCode,
        signalName: opts.signalName,
        isCanceled: opts.isCanceled ?? false,
        stderr: opts.stderr ?? '',
    });
    if (opts.cause !== undefined) {
        (e as { cause?: unknown }).cause = opts.cause;
    }
    return e;
}

/**
 * Creates a mock {@linkcode SpawnFn} returning a nano-spawn `Subprocess` fake: a
 * thenable that resolves to a {@linkcode SpawnResult} (or rejects with the given
 * error), plus `.stdout`/`.stderr` line iterables for JSON-lines mode.
 */
function createMockSpawn(options?: {
    stdout?: string;
    stderr?: string;
    stderrLines?: readonly string[];
    error?: Error;
}): Mock<SpawnFn> {
    const { stdout = '', stderr = '', stderrLines, error } = options ?? {};
    return mock.fn<SpawnFn>((command: string): Subprocess => {
        const promise = error
            ? Promise.reject(error)
            : Promise.resolve(makeResult(command, stdout, stderr));
        // Prevent an unhandled-rejection warning; the executor still awaits it.
        void promise.catch(() => { /* handled by the executor */ });

        const subprocess = promise as unknown as Subprocess;
        void Object.defineProperties(subprocess, {
            stdout: { value: asyncLines(stdout ? stdout.split('\n') : []) },
            stderr: { value: asyncLines(stderrLines ?? (stderr ? stderr.split('\n') : [])) },
        });
        return subprocess;
    });
}

describe('ProcessExecutor (unit)', () => {
    describe('background execution', () => {
        it('should capture stdout and stderr', async () => {
            const { vscode: code } = createMockVsCode();
            const spawnFn = createMockSpawn({ stdout: 'out', stderr: 'err' });
            const executor = new ProcessExecutor(code, spawnFn);

            const result = await executor.spawn({
                execution: 'background',
                command: 'test-cmd',
                args: ['arg1'],
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
                command: 'test-cmd',
                parseJson: true,
            });

            expect(result.json).to.deep.equal({ key: 'value' });
            expect(result.stdout).to.equal('{"key":"value"}');
        });

        it('should throw ChildProcessError on non-zero exit code', async () => {
            const { vscode: code } = createMockVsCode();
            const spawnFn = createMockSpawn({ error: makeSubprocessError({ exitCode: 1, stderr: 'failure reason' }) });
            const executor = new ProcessExecutor(code, spawnFn);

            try {
                await executor.spawn({
                    execution: 'background',
                    command: 'test-cmd',
                });
                expect.fail('Expected error');
            } catch (e) {
                expect(isChildProcessError(e)).to.be.true;
                expect((e as Error).message).to.equal('failure reason');
                expect((e as ChildProcessError).code).to.equal(1);
            }
        });

        it('should throw ChildProcessError when terminated by a signal', async () => {
            const { vscode: code } = createMockVsCode();
            const spawnFn = createMockSpawn({ error: makeSubprocessError({ signalName: 'SIGTERM', stderr: 'killed' }) });
            const executor = new ProcessExecutor(code, spawnFn);

            try {
                await executor.spawn({
                    execution: 'background',
                    command: 'test-cmd',
                });
                expect.fail('Expected error');
            } catch (e) {
                expect(isChildProcessError(e)).to.be.true;
                expect((e as ChildProcessError).code).to.equal(-1);
                expect((e as ChildProcessError).signal).to.equal('SIGTERM');
            }
        });

        it('should throw CancellationError when the subprocess reports isCanceled', async () => {
            const { vscode: code } = createMockVsCode();
            const spawnFn = createMockSpawn({ error: makeSubprocessError({ isCanceled: true }) });
            const executor = new ProcessExecutor(code, spawnFn);

            try {
                await executor.spawn({
                    execution: 'background',
                    command: 'test-cmd',
                });
                expect.fail('Expected error');
            } catch (e) {
                expect(CancellationError.test(e)).to.be.true;
            }
        });

        it('should preserve the ENOENT code from a spawn-time failure', async () => {
            // A start failure (no exitCode, no signal) surfaces the underlying
            // cause so callers (e.g. AzdService) can still inspect `.code`.
            const { vscode: code } = createMockVsCode();
            const cause = Object.assign(new Error('spawn test-cmd ENOENT'), { code: 'ENOENT' });
            const spawnFn = createMockSpawn({ error: makeSubprocessError({ message: 'Command failed', cause }) });
            const executor = new ProcessExecutor(code, spawnFn);

            try {
                await executor.spawn({
                    execution: 'background',
                    command: 'test-cmd',
                });
                expect.fail('Expected error');
            } catch (e) {
                expect(isChildProcessError(e)).to.be.false;
                expect((e as { code?: string }).code).to.equal('ENOENT');
            }
        });

        it('should reject promptly when the process fails to spawn', async () => {
            // Mirrors a spawn-time failure (e.g. EINVAL/ENOENT): the process
            // never starts. The rejection must settle promptly, not hang.
            const { vscode: code } = createMockVsCode();
            const spawnFn = createMockSpawn({ error: makeSubprocessError({ message: 'spawn test-cmd EINVAL' }) });
            const executor = new ProcessExecutor(code, spawnFn);

            const spawnResult = executor.spawn({
                execution: 'background',
                command: 'test-cmd',
            });

            const timedOut = Symbol('timed-out');
            const outcome = await Promise.race([
                spawnResult.then(() => undefined, (e: unknown) => e),
                delay(2000).then(() => timedOut),
            ]);

            expect(outcome, 'spawn() hung instead of rejecting').to.not.equal(timedOut);
            expect((outcome as Error).message).to.include('EINVAL');
        });

        it('should pass the command and args from a CommandLineBuilder', async () => {
            const { vscode: code } = createMockVsCode();
            const spawnFn = createMockSpawn({ stdout: 'ok' });
            const executor = new ProcessExecutor(code, spawnFn);

            await executor.spawn({
                execution: 'background',
                command: command('test-cmd').arg('sub').named('--name', 'value').flag('--force'),
            });

            expect(spawnFn.mock.callCount()).to.equal(1);
            const [cmd, args] = spawnFn.mock.calls[0].arguments;
            expect(cmd).to.equal('test-cmd');
            expect(args).to.deep.equal(['sub', '--name', 'value', '--force']);
        });

        it('should forward the shell option to nano-spawn', async () => {
            const { vscode: code } = createMockVsCode();
            const spawnFn = createMockSpawn({ stdout: 'ok' });
            const executor = new ProcessExecutor(code, spawnFn);

            await executor.spawn({
                execution: 'background',
                command: 'az',
                args: ['account', 'show'],
                shell: true,
            });

            const options = spawnFn.mock.calls[0].arguments[2]!;
            expect(options.shell).to.equal(true);
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
                command: 'test-cmd',
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
            expect(completed.stderr).to.include('step');
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
                command: 'test-cmd',
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
                command: process.execPath,
                args: ['--version'],
                name: 'Test Task',
            });

            const taskExecution = await getTaskExecution(m);

            m.taskProcessEndEmitter.fire({
                execution: taskExecution,
                exitCode: 0,
            });

            await promise;
        });

        it('should reject with ChildProcessError on non-zero exit code', async () => {
            const m = createMockVsCode();
            const executor = new ProcessExecutor(m.vscode);

            const promise = executor.spawn({
                execution: 'foreground',
                command: process.execPath,
                name: 'Failing Task',
            });

            const taskExecution = await getTaskExecution(m);

            m.taskProcessEndEmitter.fire({
                execution: taskExecution,
                exitCode: 42,
            });

            try {
                await promise;
                expect.fail('Expected error');
            } catch (e) {
                expect(isChildProcessError(e)).to.be.true;
                expect((e as Error).message).to.include('42');
                expect((e as Error).message).to.include('Failing Task');
            }
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
                command: process.execPath,
                name: 'Cancelable Task',
            }, token);

            const taskExecution = await getTaskExecution(m);

            // Cancel
            emitter.fire();

            try {
                await promise;
                expect.fail('Expected error');
            } catch (e) {
                expect(CancellationError.test(e)).to.be.true;
            }

            // Verify terminate was called
            const terminate = (taskExecution as unknown as { terminate: Mock<() => void> }).terminate;
            expect(terminate.mock.callCount()).to.equal(1);
        });

        it('should ignore events from other task executions', async () => {
            const m = createMockVsCode();
            const executor = new ProcessExecutor(m.vscode);

            const promise = executor.spawn({
                execution: 'foreground',
                command: process.execPath,
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
                command: process.execPath,
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
                command: process.execPath,
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
                command: process.execPath,
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
    function evalNode(source: string): { command: string; args: string[]; env: Record<string, string> } {
        return {
            command: process.execPath,
            args: ['-e', 'eval(process.env.NODE_EVAL_SOURCE)'],
            env: { ...env, NODE_EVAL_SOURCE: source }, // eslint-disable-line @typescript-eslint/naming-convention
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

        it('should throw ChildProcessError on non-zero exit code', async () => {
            const { vscode: code } = createMockVsCode();
            const executor = new ProcessExecutor(code);

            try {
                await executor.spawn({
                    execution: 'background',
                    ...evalNode('process.stderr.write("failure reason"); process.exit(1);'),
                });
                expect.fail('Expected error');
            } catch (e) {
                expect(isChildProcessError(e)).to.be.true;
                expect((e as Error).message).to.equal('failure reason');
            }
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

            try {
                await promise;
                expect.fail('Expected error');
            } catch (e) {
                expect(CancellationError.test(e)).to.be.true;
            }
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
            expect(completed.stderr).to.include('step');
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

    describe('isOnPath', () => {
        it('should return true for a command that exists', async () => {
            const { vscode: code } = createMockVsCode();
            const executor = new ProcessExecutor(code);

            // node is always on PATH in this test environment
            const result = await executor.isOnPath('node');

            expect(result).to.be.true;
        });

        it('should return false for a command that does not exist', async () => {
            const { vscode: code } = createMockVsCode();
            const executor = new ProcessExecutor(code);

            const result = await executor.isOnPath('definitely-not-a-real-command-xyz');

            expect(result).to.be.false;
        });
    });
});
