/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock, type Mock } from 'node:test';
import type * as vscode from 'vscode';
import { ChildProcessError, ProcessExecutor, isChildProcessError, type SpawnFn } from '../../base/IProcessExecutor';
import { CancellationError } from '../../vscode/CancellationError';
import { EventEmitter } from '../../vscode/EventEmitter';
import { createMockVsCode } from '../vscode/MockVsCode';

/**
 * Creates a mock {@linkcode SpawnFn} that writes preset data to the
 * stdout/stderr pipes and resolves (or rejects) on demand.
 */
function createMockSpawn(options?: {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
}): SpawnFn {
    const { stdout = '', stderr = '', exitCode = 0 } = options ?? {};
    const fn: SpawnFn = mock.fn(
        (_cmd: string, _args: unknown[], opts: { stdOutPipe?: NodeJS.WritableStream; stdErrPipe?: NodeJS.WritableStream }) => {
            return new Promise<void>((resolve, reject) => {
                opts.stdOutPipe?.write(stdout);
                opts.stdOutPipe?.end();
                opts.stdErrPipe?.write(stderr);
                opts.stdErrPipe?.end(() => {
                    if (exitCode !== 0) {
                        reject(new ChildProcessError(`Process exited with code ${exitCode}`, exitCode, null));
                    } else {
                        resolve();
                    }
                });
            });
        },
    );
    return fn;
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
            const spawnFn = createMockSpawn({ stderr: 'failure reason', exitCode: 1 });
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
            }
        });

        it('should convert CancellationError from processutils', async () => {
            const { vscode: code } = createMockVsCode();
            const { CancellationError: ProcessCancelError } = await import('@microsoft/vscode-processutils');
            const spawnFn = mock.fn(
                (_cmd: string, _args: unknown[], opts: { stdOutPipe?: NodeJS.WritableStream; stdErrPipe?: NodeJS.WritableStream }) => {
                    opts.stdOutPipe?.end();
                    opts.stdErrPipe?.end();
                    return Promise.reject(new ProcessCancelError('cancelled'));
                },
            ) as unknown as SpawnFn;
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

        it('should stream JSON lines from stderr', async () => {
            const { vscode: code } = createMockVsCode();
            const stderrData = '{"step":1}\n{"step":2}\n';
            // Use a mock that defers stream writes so readline can attach
            const spawnFn = mock.fn(
                (_cmd: string, _args: unknown[], opts: { stdOutPipe?: NodeJS.WritableStream; stdErrPipe?: NodeJS.WritableStream }) => {
                    opts.stdOutPipe?.write('{"done":true}');
                    opts.stdOutPipe?.end();
                    return new Promise<void>((resolve) => {
                        setTimeout(() => {
                            opts.stdErrPipe?.write(stderrData);
                            opts.stdErrPipe?.end(resolve);
                        }, 0);
                    });
                },
            ) as unknown as SpawnFn;
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
            const stderrData = 'not json\n{"valid":true}\nalso not json\n';
            const spawnFn = mock.fn(
                (_cmd: string, _args: unknown[], opts: { stdOutPipe?: NodeJS.WritableStream; stdErrPipe?: NodeJS.WritableStream }) => {
                    opts.stdOutPipe?.write('{}');
                    opts.stdOutPipe?.end();
                    return new Promise<void>((resolve) => {
                        setTimeout(() => {
                            opts.stdErrPipe?.write(stderrData);
                            opts.stdErrPipe?.end(resolve);
                        }, 0);
                    });
                },
            ) as unknown as SpawnFn;
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
            await new Promise(resolve => setTimeout(resolve, 0));
            const executeTask = m.tasks.executeTask as unknown as Mock<typeof m.vscode.tasks.executeTask>;
            expect(executeTask.mock.callCount()).to.equal(1);
            return executeTask.mock.calls[0].result as Promise<vscode.TaskExecution>;
        }

        it('should create a task and resolve on exit code 0', async () => {
            const m = createMockVsCode();
            const executor = new ProcessExecutor(m.vscode);

            const promise = executor.spawn({
                execution: 'foreground',
                command: process.execPath,
                args: ['--version'],
                taskName: 'Test Task',
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
                taskName: 'Failing Task',
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
                taskName: 'Cancelable Task',
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
                taskName: 'My Task',
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
                taskName: 'Fancy Task',
                alwaysRunNew: true,
                focus: true,
                source: 'mySource',
            });

            const executeTask = m.tasks.executeTask as unknown as Mock<typeof m.vscode.tasks.executeTask>;
            await new Promise(resolve => setTimeout(resolve, 0));
            const task = executeTask.mock.calls[0].arguments[0];

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
                taskName: 'Scoped Task',
                workspaceFolder: folder,
            });

            const executeTask = m.tasks.executeTask as unknown as Mock<typeof m.vscode.tasks.executeTask>;
            await new Promise(resolve => setTimeout(resolve, 0));
            const task = executeTask.mock.calls[0].arguments[0];

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
                taskName: 'Default Task',
            });

            const executeTask = m.tasks.executeTask as unknown as Mock<typeof m.vscode.tasks.executeTask>;
            await new Promise(resolve => setTimeout(resolve, 0));
            const task = executeTask.mock.calls[0].arguments[0];

            expect(task.source).to.equal('process');
            expect(task.scope).to.equal(2); // TaskScope.Workspace

            const taskExecution = await getTaskExecution(m);
            m.taskProcessEndEmitter.fire({ execution: taskExecution, exitCode: 0 });
            await promise;
        });
    });
});

describe('ProcessExecutor (integration)', () => {
    function script(code: string): string {
        const dir = mkdtempSync(join(tmpdir(), 'proc-test-'));
        const file = join(dir, 'test.mjs');
        writeFileSync(file, code, 'utf-8');
        return file;
    }

    describe('background execution', () => {
        it('should capture stdout and stderr', async () => {
            const { vscode: code } = createMockVsCode();
            const executor = new ProcessExecutor(code);

            const result = await executor.spawn({
                execution: 'background',
                command: process.execPath,
                args: [script('process.stdout.write("out"); process.stderr.write("err");')],
            });

            expect(result.stdout).to.equal('out');
            expect(result.stderr).to.equal('err');
        });

        it('should parse stdout as JSON when parseJson is true', async () => {
            const { vscode: code } = createMockVsCode();
            const executor = new ProcessExecutor(code);

            const result = await executor.spawn<{ key: string }>({
                execution: 'background',
                command: process.execPath,
                args: [script('process.stdout.write(JSON.stringify({ key: "value" }));')],
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
                    command: process.execPath,
                    args: [script('process.stderr.write("failure reason"); process.exit(1);')],
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
                command: process.execPath,
                args: [script('setTimeout(() => {}, 30000);')],
            }, token);

            await new Promise(resolve => setTimeout(resolve, 50));
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

            const f = script([
                'process.stderr.write(JSON.stringify({ step: 1 }) + "\\n");',
                'process.stderr.write(JSON.stringify({ step: 2 }) + "\\n");',
                'process.stdout.write(JSON.stringify({ done: true }));',
            ].join('\n'));

            const result = await executor.spawn<{ done: boolean }>({
                execution: 'background',
                command: process.execPath,
                args: [f],
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

            const f = script([
                'process.stderr.write("not json\\n");',
                'process.stderr.write(JSON.stringify({ valid: true }) + "\\n");',
                'process.stderr.write("also not json\\n");',
                'process.stdout.write("{}");',
            ].join('\n'));

            const result = await executor.spawn({
                execution: 'background',
                command: process.execPath,
                args: [f],
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
});
