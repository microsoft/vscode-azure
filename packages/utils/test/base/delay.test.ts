/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { delay } from '../../src/base/delay';
import { CancellationError } from '../../src/vscode/CancellationError';
import { EventEmitter } from '../../src/vscode/EventEmitter';

describe('delay (unit)', () => {
    it('should resolve after the specified time', async () => {
        const start = Date.now();
        await delay(50);
        expect(Date.now() - start).to.be.at.least(40);
    });

    it('should reject with CancellationError when AbortSignal is already aborted', async () => {
        const controller = new AbortController();
        controller.abort();

        const error = await expect(delay(5000, controller.signal)).to.be.rejected;
        expect(CancellationError.test(error)).to.be.true;
    });

    it('should reject with CancellationError when AbortSignal fires during delay', async () => {
        const controller = new AbortController();

        const promise = delay(5000, controller.signal);
        setTimeout(() => { controller.abort(); }, 30);

        const error = await expect(promise).to.be.rejected;
        expect(CancellationError.test(error)).to.be.true;
    });

    it('should reject with CancellationError when cancellationToken is already cancelled', async () => {
        const token = {
            isCancellationRequested: true,
            onCancellationRequested: () => ({ dispose: () => { /* noop */ } }),
        };

        const error = await expect(delay(5000, token)).to.be.rejected;
        expect(CancellationError.test(error)).to.be.true;
    });

    it('should reject with CancellationError when cancellationToken fires during delay', async () => {
        const emitter = new EventEmitter<void>();
        const token = {
            isCancellationRequested: false,
            onCancellationRequested: emitter.event,
        };

        const promise = delay(5000, token);
        setTimeout(() => { emitter.fire(); }, 30);

        const error = await expect(promise).to.be.rejected;
        expect(CancellationError.test(error)).to.be.true;
    });

    it('should resolve without options', async () => {
        const start = Date.now();
        await delay(30);
        expect(Date.now() - start).to.be.at.least(20);
    });
});
