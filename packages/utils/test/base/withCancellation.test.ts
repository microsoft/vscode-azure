/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mock } from 'node:test';
import { withCancellation } from '../../src/base/withCancellation';
import { CancellationError } from '../../src/vscode/CancellationError';
import { EventEmitter } from '../../src/vscode/EventEmitter';

describe('withCancellation (unit)', () => {
    afterEach(() => { mock.restoreAll(); });

    it('returns the operation result without a cancellation source', async () => {
        const operation = mock.fn(() => Promise.resolve(42));
        expect(await withCancellation(operation)).to.equal(42);
        expect(operation.mock.calls[0].arguments).to.deep.equal([undefined]);
    });

    it('passes through the caller signal and removes its listener on success', async () => {
        const controller = new AbortController();
        const remove = mock.method(controller.signal, 'removeEventListener');
        await withCancellation(signal => {
            expect(signal).to.equal(controller.signal);
            return Promise.resolve();
        }, controller.signal);
        expect(remove.mock.callCount()).to.equal(1);
    });

    for (const synchronous of [false, true]) {
        it(`preserves ${synchronous ? 'synchronous' : 'asynchronous'} failures and releases listeners`, async () => {
            const controller = new AbortController();
            const remove = mock.method(controller.signal, 'removeEventListener');
            const error = new Error('operation failed');
            await expect(withCancellation(() => {
                if (synchronous) {
                    throw error;
                }
                return Promise.reject(error);
            }, controller.signal)).to.be.rejectedWith(error);
            expect(remove.mock.callCount()).to.equal(1);
        });
    }

    it('does not start an operation when the signal is already aborted', async () => {
        const operation = mock.fn(() => Promise.resolve());
        await expect(withCancellation(operation, AbortSignal.abort())).to.be.rejectedWith(CancellationError);
        expect(operation.mock.callCount()).to.equal(0);
    });

    it('does not start an operation when the token is already canceled', async () => {
        const emitter = new EventEmitter<void>();
        const operation = mock.fn(() => Promise.resolve());
        try {
            await expect(withCancellation(operation, {
                isCancellationRequested: true, onCancellationRequested: emitter.event,
            })).to.be.rejectedWith(CancellationError);
            expect(operation.mock.callCount()).to.equal(0);
        } finally {
            emitter.dispose();
        }
    });

    it('cancels an unfinished operation and handles its late rejection', async () => {
        const controller = new AbortController();
        const remove = mock.method(controller.signal, 'removeEventListener');
        const pending = Promise.withResolvers<undefined>();
        const result = withCancellation(() => pending.promise, controller.signal);
        const rejected = expect(result).to.be.rejectedWith(CancellationError);
        controller.abort();
        await rejected;
        pending.reject(new Error('late failure'));
        await Promise.resolve();
        expect(remove.mock.callCount()).to.equal(1);
    });

    it('bridges token cancellation and disposes its subscription', async () => {
        const emitter = new EventEmitter<void>();
        const dispose = mock.fn();
        const token = {
            isCancellationRequested: false,
            onCancellationRequested: (listener: (value: unknown) => unknown) => {
                const subscription = emitter.event(listener);
                return { dispose: () => { dispose(); subscription.dispose(); } };
            },
        };
        const pending = Promise.withResolvers<undefined>();
        let signal: AbortSignal | undefined;
        try {
            const result = withCancellation(value => {
                signal = value;
                return pending.promise;
            }, token);
            const rejected = expect(result).to.be.rejectedWith(CancellationError);
            emitter.fire();
            await rejected;
            expect(signal?.aborted).to.be.true;
            expect(dispose.mock.callCount()).to.equal(1);
            pending.resolve(undefined);
        } finally {
            emitter.dispose();
        }
    });
});
