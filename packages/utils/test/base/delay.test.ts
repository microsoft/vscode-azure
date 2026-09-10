/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mock } from 'node:test';
import { delay } from '../../src/base/delay';
import { CancellationError } from '../../src/vscode/CancellationError';
import { EventEmitter } from '../../src/vscode/EventEmitter';

describe('delay (unit)', () => {
    beforeEach(() => {
        mock.timers.enable({ apis: ['setTimeout'] });
    });

    afterEach(() => {
        mock.timers.reset();
    });

    it('should resolve after the specified time', async () => {
        const resolved = mock.fn();
        const promise = delay(50).then(resolved);

        mock.timers.tick(49);
        await Promise.resolve();
        expect(resolved.mock.callCount()).to.equal(0);

        mock.timers.tick(1);
        await promise;
        expect(resolved.mock.callCount()).to.equal(1);
    });

    it('should reject with CancellationError when AbortSignal is already aborted', async () => {
        const controller = new AbortController();
        controller.abort();

        await expect(delay(5000, controller.signal)).to.be.rejectedWith(CancellationError);
    });

    it('should reject with CancellationError when AbortSignal fires during delay', async () => {
        const controller = new AbortController();

        const promise = delay(5000, controller.signal);
        const rejected = expect(promise).to.be.rejectedWith(CancellationError);

        mock.timers.tick(30);
        controller.abort();

        await rejected;
    });

    it('should reject with CancellationError when cancellationToken is already cancelled', async () => {
        const token = {
            isCancellationRequested: true,
            onCancellationRequested: () => ({ dispose: () => { /* noop */ } }),
        };

        await expect(delay(5000, token)).to.be.rejectedWith(CancellationError);
    });

    it('should reject with CancellationError when cancellationToken fires during delay', async () => {
        const emitter = new EventEmitter<void>();
        const token = {
            isCancellationRequested: false,
            onCancellationRequested: emitter.event,
        };

        const promise = delay(5000, token);
        const rejected = expect(promise).to.be.rejectedWith(CancellationError);

        mock.timers.tick(30);
        emitter.fire();

        await rejected;
    });
});
