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
import { MockUri } from '../vscode/MockUri';
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
                name: 'Scoped Task',
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
                name: 'Default Task',
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

    describe('terminal execution', () => {
        function createMockTerminal(shellIntegration?: unknown) {
            return {
                name: '',
                shellIntegration,
                show: mock.fn(),
                dispose: mock.fn(),
            };
        }

        function createMockShellIntegration() {
            const outputChunks: string[] = [];
            const execution = {
                commandLine: { value: 'test-cmd', isTrusted: true, confidence: 0 },
                cwd: MockUri.file('/'),
                read: () => (async function* () { // eslint-disable-line @typescript-eslint/require-await
                    for (const chunk of outputChunks) {
                        yield chunk;
                    }
                })(),
            };
            const shellIntegration = {
                executeCommand: mock.fn(() => execution),
            };
            return { shellIntegration, execution, outputChunks };
        }

        it('should use existing shellIntegration when already available on terminal', async () => {
            const m = createMockVsCode();
            const { shellIntegration, execution, outputChunks } = createMockShellIntegration();
            outputChunks.push('hello world');

            (m.window.createTerminal as unknown as ReturnType<typeof mock.fn>).mock.mockImplementation(
                () => createMockTerminal(shellIntegration),
            );

            const executor = new ProcessExecutor(m.vscode);

            const resultPromise = executor.spawn({
                execution: 'terminal',
                command: process.execPath,
                args: ['--version'],
                name: 'Test Terminal',
            });

            // Shell integration is already available, so executeCommand should be called immediately
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(shellIntegration.executeCommand.mock.callCount()).to.equal(1);

            // Fire the end event
            m.shellExecutionEndEmitter.fire({
                execution: execution as unknown as vscode.TerminalShellExecution,
                terminal: {} as vscode.Terminal,
                exitCode: 0,
                shellIntegration: shellIntegration as unknown as vscode.TerminalShellIntegration,
            });

            const result = await resultPromise;
            expect(result.shellIntegration).to.be.true;

            const chunks: string[] = [];
            for await (const chunk of result.output) {
                chunks.push(chunk);
            }
            expect(chunks).to.deep.equal(['hello world']);

            const { exitCode } = await result.completed;
            expect(exitCode).to.equal(0);
        });

        it('should wait for shell integration via onDidChangeTerminalShellIntegration', async () => {
            const m = createMockVsCode();
            const { shellIntegration, execution, outputChunks } = createMockShellIntegration();
            outputChunks.push('output');

            let createdTerminal: ReturnType<typeof createMockTerminal>;
            (m.window.createTerminal as unknown as ReturnType<typeof mock.fn>).mock.mockImplementation(() => {
                createdTerminal = createMockTerminal(undefined);
                return createdTerminal;
            });

            const executor = new ProcessExecutor(m.vscode);

            const resultPromise = executor.spawn({
                execution: 'terminal',
                command: process.execPath,
                name: 'Awaited Terminal',
            });

            // Give spawn a tick to create the terminal and start waiting
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(createdTerminal!).to.not.be.undefined;

            // Fire shell integration for the created terminal
            m.shellIntegrationChangeEmitter.fire({
                terminal: createdTerminal! as unknown as vscode.Terminal,
                shellIntegration: shellIntegration as unknown as vscode.TerminalShellIntegration,
            });

            // Now executeCommand should be called
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(shellIntegration.executeCommand.mock.callCount()).to.equal(1);

            // Complete the execution
            m.shellExecutionEndEmitter.fire({
                execution: execution as unknown as vscode.TerminalShellExecution,
                terminal: createdTerminal! as unknown as vscode.Terminal,
                exitCode: 0,
                shellIntegration: shellIntegration as unknown as vscode.TerminalShellIntegration,
            });

            const result = await resultPromise;
            expect(result.shellIntegration).to.be.true;
            const { exitCode } = await result.completed;
            expect(exitCode).to.equal(0);
        });

        it('should reject with CancellationError when cancelled during terminal execution', async () => {
            const m = createMockVsCode();
            const { shellIntegration } = createMockShellIntegration();

            let createdTerminal: ReturnType<typeof createMockTerminal>;
            (m.window.createTerminal as unknown as ReturnType<typeof mock.fn>).mock.mockImplementation(() => {
                createdTerminal = createMockTerminal(shellIntegration);
                return createdTerminal;
            });

            const emitter = new EventEmitter<void>();
            const token = {
                isCancellationRequested: false,
                onCancellationRequested: emitter.event,
            };

            const executor = new ProcessExecutor(m.vscode);

            const resultPromise = executor.spawn({
                execution: 'terminal',
                command: process.execPath,
                name: 'Cancelable Terminal',
            }, token);

            await new Promise(resolve => setTimeout(resolve, 0));

            const result = await resultPromise;
            expect(result.shellIntegration).to.be.true;

            // Cancel while waiting for completion
            emitter.fire();

            try {
                await result.completed;
                expect.fail('Expected error');
            } catch (e) {
                expect(CancellationError.test(e)).to.be.true;
            }

            // Verify terminal was disposed
            expect(createdTerminal!.dispose.mock.callCount()).to.equal(1);
        });

        it('should ignore shell execution end events from other executions', async () => {
            const m = createMockVsCode();
            const { shellIntegration, execution } = createMockShellIntegration();

            (m.window.createTerminal as unknown as ReturnType<typeof mock.fn>).mock.mockImplementation(
                () => createMockTerminal(shellIntegration),
            );

            const executor = new ProcessExecutor(m.vscode);

            const resultPromise = executor.spawn({
                execution: 'terminal',
                command: process.execPath,
                name: 'Filter Terminal',
            });

            await new Promise(resolve => setTimeout(resolve, 0));

            const result = await resultPromise;

            // Fire end event for a *different* execution -- should be ignored
            m.shellExecutionEndEmitter.fire({
                execution: { commandLine: {}, cwd: MockUri.file('/'), read: () => (async function* () { yield ''; })() } as unknown as vscode.TerminalShellExecution, // eslint-disable-line @typescript-eslint/require-await
                terminal: {} as vscode.Terminal,
                exitCode: 99,
                shellIntegration: shellIntegration as unknown as vscode.TerminalShellIntegration,
            });

            // Now fire for the real execution
            m.shellExecutionEndEmitter.fire({
                execution: execution as unknown as vscode.TerminalShellExecution,
                terminal: {} as vscode.Terminal,
                exitCode: 0,
                shellIntegration: shellIntegration as unknown as vscode.TerminalShellIntegration,
            });

            const { exitCode } = await result.completed;
            expect(exitCode).to.equal(0);
        });

        it('should pass name, cwd and env to createTerminal', async () => {
            const m = createMockVsCode();
            const { shellIntegration, execution } = createMockShellIntegration();

            (m.window.createTerminal as unknown as ReturnType<typeof mock.fn>).mock.mockImplementation(
                () => createMockTerminal(shellIntegration),
            );

            const executor = new ProcessExecutor(m.vscode);

            const resultPromise = executor.spawn({
                execution: 'terminal',
                command: process.execPath,
                name: 'Named Terminal',
                cwd: MockUri.file('/test/dir') as unknown as vscode.Uri,
                env: { MY_VAR: 'value' }, // eslint-disable-line @typescript-eslint/naming-convention
            });

            await new Promise(resolve => setTimeout(resolve, 0));

            const ctFn = m.window.createTerminal as unknown as ReturnType<typeof mock.fn>;
            const callArgs = ctFn.mock.calls[0].arguments[0] as {
                name: string;
                cwd: unknown;
                env: Record<string, string>;
            };
            expect(callArgs.name).to.equal('Named Terminal');
            expect((callArgs.cwd as MockUri).path).to.equal('/test/dir');
            expect(callArgs.env).to.deep.equal({ MY_VAR: 'value' }); // eslint-disable-line @typescript-eslint/naming-convention

            // Clean up
            m.shellExecutionEndEmitter.fire({
                execution: execution as unknown as vscode.TerminalShellExecution,
                terminal: {} as vscode.Terminal,
                exitCode: 0,
                shellIntegration: shellIntegration as unknown as vscode.TerminalShellIntegration,
            });
            await resultPromise;
        });

        it('should reject with ChildProcessError on non-zero exit code', async () => {
            const m = createMockVsCode();
            const { shellIntegration, execution } = createMockShellIntegration();

            (m.window.createTerminal as unknown as ReturnType<typeof mock.fn>).mock.mockImplementation(
                () => createMockTerminal(shellIntegration),
            );

            const executor = new ProcessExecutor(m.vscode);

            const resultPromise = executor.spawn({
                execution: 'terminal',
                command: process.execPath,
                name: 'Failing Terminal',
            });

            await new Promise(resolve => setTimeout(resolve, 0));

            m.shellExecutionEndEmitter.fire({
                execution: execution as unknown as vscode.TerminalShellExecution,
                terminal: {} as vscode.Terminal,
                exitCode: 42,
                shellIntegration: shellIntegration as unknown as vscode.TerminalShellIntegration,
            });

            const result = await resultPromise;
            expect(result.shellIntegration).to.be.true;

            try {
                await result.completed;
                expect.fail('Expected error');
            } catch (e) {
                expect(isChildProcessError(e)).to.be.true;
                expect((e as Error).message).to.include('42');
            }
        });

        it('should return shellIntegration false when shell integration times out', async () => {
            const m = createMockVsCode();

            let createdTerminal: ReturnType<typeof createMockTerminal>;
            (m.window.createTerminal as unknown as ReturnType<typeof mock.fn>).mock.mockImplementation(() => {
                createdTerminal = createMockTerminal(undefined);
                return createdTerminal;
            });

            const executor = new ProcessExecutor(m.vscode);

            // Use fake timers to avoid a real 5-second wait
            const clock = mock.timers;
            clock.enable({ apis: ['setTimeout'] });

            const resultPromise = executor.spawn({
                execution: 'terminal',
                command: process.execPath,
                name: 'Timeout Terminal',
            });

            // Let the terminal creation happen
            await new Promise(resolve => setImmediate(resolve));

            // Advance past the shell integration timeout
            clock.tick(6000);

            const result = await resultPromise;
            expect(result.shellIntegration).to.be.false;

            // Terminal should be disposed
            expect(createdTerminal!.dispose.mock.callCount()).to.equal(1);

            const { exitCode } = await result.completed;
            expect(exitCode).to.be.undefined;

            clock.reset();
        });

        it('should cancel waitForShellIntegration and dispose terminal when cancelled before shell integration', async () => {
            const m = createMockVsCode();

            let createdTerminal: ReturnType<typeof createMockTerminal>;
            (m.window.createTerminal as unknown as ReturnType<typeof mock.fn>).mock.mockImplementation(() => {
                createdTerminal = createMockTerminal(undefined);
                return createdTerminal;
            });

            const emitter = new EventEmitter<void>();
            const token = {
                isCancellationRequested: false,
                onCancellationRequested: emitter.event,
            };

            const executor = new ProcessExecutor(m.vscode);

            const resultPromise = executor.spawn({
                execution: 'terminal',
                command: process.execPath,
                name: 'Cancel-Before-SI Terminal',
            }, token);

            // Let the terminal creation happen
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(createdTerminal!).to.not.be.undefined;

            // Cancel before shell integration arrives
            emitter.fire();

            const result = await resultPromise;
            // waitForShellIntegration resolved undefined due to cancellation
            expect(result.shellIntegration).to.be.false;

            // Terminal should be disposed
            expect(createdTerminal!.dispose.mock.callCount()).to.equal(1);
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
