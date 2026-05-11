/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { delay } from '../../base/delay';
import { CancellationError } from '../../vscode/CancellationError';
import { EventEmitter } from '../../vscode/EventEmitter';

describe('delay (unit)', () => {
    it('should resolve after the specified time', async () => {
        const start = Date.now();
        await delay(50);
        expect(Date.now() - start).to.be.at.least(40);
    });

    it('should reject with CancellationError when AbortSignal is already aborted', async () => {
        const controller = new AbortController();
        controller.abort();

        try {
            await delay(5000, { signal: controller.signal });
            expect.fail('Expected CancellationError');
        } catch (e) {
            expect(CancellationError.test(e)).to.be.true;
        }
    });

    it('should reject with CancellationError when AbortSignal fires during delay', async () => {
        const controller = new AbortController();

        const promise = delay(5000, { signal: controller.signal });
        setTimeout(() => { controller.abort(); }, 30);

        try {
            await promise;
            expect.fail('Expected CancellationError');
        } catch (e) {
            expect(CancellationError.test(e)).to.be.true;
        }
    });

    it('should reject with CancellationError when cancellationToken is already cancelled', async () => {
        const token = {
            isCancellationRequested: true,
            onCancellationRequested: () => ({ dispose: () => { /* noop */ } }),
        };

        try {
            await delay(5000, { cancellationToken: token });
            expect.fail('Expected CancellationError');
        } catch (e) {
            expect(CancellationError.test(e)).to.be.true;
        }
    });

    it('should reject with CancellationError when cancellationToken fires during delay', async () => {
        const emitter = new EventEmitter<void>();
        const token = {
            isCancellationRequested: false,
            onCancellationRequested: emitter.event,
        };

        const promise = delay(5000, { cancellationToken: token });
        setTimeout(() => { emitter.fire(); }, 30);

        try {
            await promise;
            expect.fail('Expected CancellationError');
        } catch (e) {
            expect(CancellationError.test(e)).to.be.true;
        }
    });

    it('should resolve without options', async () => {
        const start = Date.now();
        await delay(30);
        expect(Date.now() - start).to.be.at.least(20);
    });
});
