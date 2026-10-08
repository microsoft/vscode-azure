/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError } from '@microsoft/vscode-azure-utils';
import { createMockVsCode, MockCancellationToken, MockFileSystem, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { withAzdJsonlOutput } from '../../src/azd/withAzdJsonlOutput';

function createOptions() {
    const code = createMockVsCode();
    const options = {
        code: code.vscode,
        file: MockUri.file('/tmp/output.jsonl'),
        intervalMs: 1,
        onEntry: mock.fn((_entry: unknown): void => undefined),
        onError: mock.fn((_kind: string): void => undefined),
    };
    return { options, fs: code.fs };
}

describe('withAzdJsonlOutput (unit)', () => {
    it('should drain output on success and preserve the task result', async () => {
        const { options, fs } = createOptions();
        const result = await withAzdJsonlOutput(options, () => {
            fs.addFile(options.file, '{"message":"done"}\n');
            return Promise.resolve(42);
        });
        expect(result).to.equal(42);
        expect(options.onEntry.mock.calls.map(call => call.arguments[0])).to.deep.equal([{ message: 'done' }]);
        expect(options.onError.mock.callCount()).to.equal(0);
    });

    it('should wait for an asynchronous handler before draining new output after task failure', async () => {
        const { options, fs } = createOptions();
        const failure = new Error('task failed');
        let finishTask!: (error: Error) => void;
        const onEntry = mock.fn(async (entry: unknown) => {
            if (options.onEntry.mock.callCount() === 0) {
                fs.addFile(options.file, '{"message":"first"}\n{"message":"second"}\n');
                finishTask(failure);
                await Promise.resolve();
            }
            options.onEntry(entry);
        });
        const execution = withAzdJsonlOutput({ ...options, onEntry }, () => {
            fs.addFile(options.file, '{"message":"first"}\n');
            return new Promise<void>((_resolve, reject) => { finishTask = reject; });
        });
        await expect(execution).to.be.rejectedWith('task failed');
        expect(onEntry.mock.calls.map(call => call.arguments[0])).to.deep.equal([
            { message: 'first' }, { message: 'second' },
        ]);
    });

    it('should retain partial UTF-8 lines across polls without replaying complete entries', async () => {
        const { options, fs } = createOptions();
        let finishTask!: () => void;
        const complete = new TextEncoder().encode('{"message":"first"}\r\n{"message":"\u00e9"}\n');
        const split = complete.indexOf(0xc3) + 1;
        const onEntry = mock.fn((entry: unknown) => {
            options.onEntry(entry);
            if (options.onEntry.mock.callCount() === 1) {
                fs.addFile(options.file, complete);
            } else {
                finishTask();
            }
        });
        await withAzdJsonlOutput({ ...options, onEntry }, () => {
            fs.addFile(options.file, complete.slice(0, split));
            return new Promise<void>(resolve => { finishTask = resolve; });
        });
        expect(onEntry.mock.calls.map(call => call.arguments[0])).to.deep.equal([
            { message: 'first' }, { message: '\u00e9' },
        ]);
    });

    it('should report malformed lines and handler failures while consuming subsequent entries', async () => {
        const { options, fs } = createOptions();
        const onEntry = mock.fn((entry: unknown) => {
            if (entry === 1) {
                throw new Error('handler failed');
            }
            options.onEntry(entry);
        });
        await withAzdJsonlOutput({ ...options, onEntry }, () => {
            fs.addFile(options.file, 'invalid\n1\n2\n');
            return Promise.resolve();
        });
        expect(options.onError.mock.calls.map(call => call.arguments[0])).to.deep.equal(['parse', 'handle']);
        expect(options.onEntry.mock.calls.map(call => call.arguments[0])).to.deep.equal([2]);
    });

    it('should allow a missing output file without reporting errors', async () => {
        const { options } = createOptions();
        await withAzdJsonlOutput(options, () => Promise.resolve());
        expect(options.onEntry.mock.callCount()).to.equal(0);
        expect(options.onError.mock.callCount()).to.equal(0);
    });

    it('should report read failures without replacing the task error', async () => {
        const { options, fs } = createOptions();
        fs.readFile.mock.mockImplementation(() => Promise.reject(MockFileSystem.createError('NoPermissions', options.file)));
        await expect(withAzdJsonlOutput(options, () => Promise.reject(new Error('task failed'))))
            .to.be.rejectedWith('task failed');
        expect(options.onError.mock.calls.map(call => call.arguments[0])).to.deep.equal(['read', 'read']);
    });

    it('should not start polling or the task with an already-aborted signal', async () => {
        const { options, fs } = createOptions();
        const controller = new AbortController();
        controller.abort();
        const task = mock.fn(() => Promise.resolve());

        await expect(withAzdJsonlOutput({ ...options, cancellation: controller.signal }, task))
            .to.be.rejectedWith(DOMException);

        expect(task.mock.callCount()).to.equal(0);
        expect(fs.readFile.mock.callCount()).to.equal(0);
    });

    it('should cancel polling and forward token cancellation to the task before draining final output', async () => {
        const { options, fs } = createOptions();
        const cancellation = new MockCancellationToken();
        const onEntry = mock.fn((entry: unknown) => {
            options.onEntry(entry);
            cancellation.cancel();
        });
        const task = mock.fn((signal?: AbortSignal) => {
            fs.addFile(options.file, '{"message":"first"}\n');
            return new Promise<void>((_resolve, reject) => {
                signal?.addEventListener('abort', () => {
                    fs.addFile(options.file, '{"message":"first"}\n{"message":"cancelled"}\n');
                    reject(new CancellationError());
                }, { once: true });
            });
        });

        try {
            await expect(withAzdJsonlOutput({ ...options, cancellation, onEntry }, task))
                .to.be.rejectedWith(DOMException);

            expect(task.mock.calls[0].arguments[0]?.aborted).to.equal(true);
            expect(options.onEntry.mock.calls.map(call => call.arguments[0])).to.deep.equal([
                { message: 'first' }, { message: 'cancelled' },
            ]);
            expect(options.onError.mock.callCount()).to.equal(0);
        } finally {
            cancellation.dispose();
        }
    });

    it('should reject cancellation even when the task resolves after receiving the signal', async () => {
        const { options } = createOptions();
        const controller = new AbortController();
        await expect(withAzdJsonlOutput({ ...options, cancellation: controller.signal }, signal => {
            expect(signal).to.equal(controller.signal);
            controller.abort();
            return Promise.resolve();
        })).to.be.rejectedWith(DOMException);
        expect(options.onError.mock.callCount()).to.equal(0);
    });
});
