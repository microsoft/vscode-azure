/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { mock } from 'node:test';
import { Debouncer } from '../../base/Debouncer';
import { delay } from '../../base/delay';

describe('Debouncer (unit)', () => {
    it('should invoke the callback once after the delay', async () => {
        const debouncer = new Debouncer();
        const cb = mock.fn();

        debouncer.debounce('k', 20, cb);
        expect(cb.mock.callCount()).to.equal(0);

        await delay(40);
        expect(cb.mock.callCount()).to.equal(1);

        debouncer.dispose();
    });

    it('should coalesce a burst on the same key into a single call', async () => {
        const debouncer = new Debouncer();
        const cb = mock.fn();

        debouncer.debounce('k', 30, cb);
        await delay(10);
        debouncer.debounce('k', 30, cb);
        await delay(10);
        debouncer.debounce('k', 30, cb);

        // Total elapsed (20ms) is less than the per-call delay, so nothing fired yet.
        expect(cb.mock.callCount()).to.equal(0);

        await delay(50);
        expect(cb.mock.callCount()).to.equal(1);

        debouncer.dispose();
    });

    it('should run the most recently supplied callback for a key', async () => {
        const debouncer = new Debouncer();
        const first = mock.fn();
        const second = mock.fn();

        debouncer.debounce('k', 20, first);
        debouncer.debounce('k', 20, second);

        await delay(40);
        expect(first.mock.callCount()).to.equal(0);
        expect(second.mock.callCount()).to.equal(1);

        debouncer.dispose();
    });

    it('should debounce different keys independently', async () => {
        const debouncer = new Debouncer();
        const a = mock.fn();
        const b = mock.fn();
        const key = Symbol('b');

        debouncer.debounce('a', 20, a);
        debouncer.debounce(key, 20, b);

        await delay(40);
        expect(a.mock.callCount()).to.equal(1);
        expect(b.mock.callCount()).to.equal(1);

        debouncer.dispose();
    });

    it('should not fire a cancelled key', async () => {
        const debouncer = new Debouncer();
        const cb = mock.fn();

        debouncer.debounce('k', 20, cb);
        debouncer.cancel('k');

        await delay(40);
        expect(cb.mock.callCount()).to.equal(0);

        debouncer.dispose();
    });

    it('should not fire pending callbacks after dispose', async () => {
        const debouncer = new Debouncer();
        const cb = mock.fn();

        debouncer.debounce('k', 20, cb);
        debouncer.dispose();

        await delay(40);
        expect(cb.mock.callCount()).to.equal(0);
    });
});
