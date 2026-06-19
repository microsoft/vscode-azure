/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { mock } from 'node:test';
import { Debouncer } from '../../base/Debouncer';

describe('Debouncer (unit)', () => {
    beforeEach(() => {
        mock.timers.enable({ apis: ['setTimeout'] });
    });

    afterEach(() => {
        mock.timers.reset();
    });

    it('should invoke the callback once after the delay', () => {
        const debouncer = new Debouncer();
        const cb = mock.fn();

        debouncer.debounce('k', 20, cb);
        expect(cb.mock.callCount()).to.equal(0);

        mock.timers.tick(40);
        expect(cb.mock.callCount()).to.equal(1);

        debouncer.dispose();
    });

    it('should coalesce a burst on the same key into a single call', () => {
        const debouncer = new Debouncer();
        const cb = mock.fn();

        debouncer.debounce('k', 30, cb);
        mock.timers.tick(10);
        debouncer.debounce('k', 30, cb);
        mock.timers.tick(10);
        debouncer.debounce('k', 30, cb);

        // Total elapsed (20ms) is less than the per-call delay, so nothing fired yet.
        expect(cb.mock.callCount()).to.equal(0);

        mock.timers.tick(50);
        expect(cb.mock.callCount()).to.equal(1);

        debouncer.dispose();
    });

    it('should run the most recently supplied callback for a key', () => {
        const debouncer = new Debouncer();
        const first = mock.fn();
        const second = mock.fn();

        debouncer.debounce('k', 20, first);
        debouncer.debounce('k', 20, second);

        mock.timers.tick(40);
        expect(first.mock.callCount()).to.equal(0);
        expect(second.mock.callCount()).to.equal(1);

        debouncer.dispose();
    });

    it('should debounce different keys independently', () => {
        const debouncer = new Debouncer();
        const a = mock.fn();
        const b = mock.fn();
        const key = Symbol('b');

        debouncer.debounce('a', 20, a);
        debouncer.debounce(key, 20, b);

        mock.timers.tick(40);
        expect(a.mock.callCount()).to.equal(1);
        expect(b.mock.callCount()).to.equal(1);

        debouncer.dispose();
    });

    it('should not fire a cancelled key', () => {
        const debouncer = new Debouncer();
        const cb = mock.fn();

        debouncer.debounce('k', 20, cb);
        debouncer.cancel('k');

        mock.timers.tick(40);
        expect(cb.mock.callCount()).to.equal(0);

        debouncer.dispose();
    });

    it('should not fire pending callbacks after dispose', () => {
        const debouncer = new Debouncer();
        const cb = mock.fn();

        debouncer.debounce('k', 20, cb);
        debouncer.dispose();

        mock.timers.tick(40);
        expect(cb.mock.callCount()).to.equal(0);
    });
});
