/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mock } from 'node:test';
import { DebounceScheduler } from '../../src/base/IDebounceScheduler';
import { delay } from '../../src/base/delay';
import { ManualDebounceScheduler } from './ManualDebounceScheduler';

describe('IDebounceScheduler (unit)', () => {
    describe('DebounceScheduler', () => {
        beforeEach(() => {
            mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
        });

        afterEach(() => {
            mock.timers.reset();
        });

        it('collapses a burst into a single run of the latest callback', () => {
            const scheduler = new DebounceScheduler(5);
            const ran: string[] = [];

            scheduler.debounce(() => { ran.push('first'); });
            scheduler.debounce(() => { ran.push('second'); });
            scheduler.debounce(() => { ran.push('third'); });

            mock.timers.tick(4);
            expect(ran).to.deep.equal([]);

            mock.timers.tick(1);
            expect(ran).to.deep.equal(['third']);

            scheduler.dispose();
        });

        it('does not run a pending callback after dispose', () => {
            const scheduler = new DebounceScheduler(5);
            let ran = false;

            scheduler.debounce(() => { ran = true; });
            scheduler.dispose();

            mock.timers.tick(5);
            expect(ran).to.be.false;
        });

        it('contains a synchronous throw and reports it', () => {
            const errors: unknown[] = [];
            const scheduler = new DebounceScheduler(5, undefined, error => errors.push(error));
            const boom = new Error('boom');

            scheduler.debounce(() => { throw boom; });

            mock.timers.tick(5);
            expect(errors).to.deep.equal([boom]);

            scheduler.dispose();
        });

        it('contains a rejected promise and reports it', async () => {
            const reported = Promise.withResolvers<unknown>();
            const onError = mock.fn(reported.resolve);
            const scheduler = new DebounceScheduler(5, undefined, onError);
            const boom = new Error('boom');

            scheduler.debounce(() => Promise.reject(boom));

            mock.timers.tick(5);
            expect(await reported.promise).to.equal(boom);
            expect(onError.mock.callCount()).to.equal(1);

            scheduler.dispose();
        });

        it('keeps working after a failed run', async () => {
            const scheduler = new DebounceScheduler(5);
            const boom = new Error('boom');
            const failed = Promise.reject(boom);
            let ran = false;

            scheduler.debounce(() => failed);
            mock.timers.tick(5);
            await expect(failed).to.be.rejectedWith(boom);

            scheduler.debounce(() => { ran = true; });
            mock.timers.tick(5);

            expect(ran).to.be.true;

            scheduler.dispose();
        });

        it('reports wall-clock time', () => {
            const scheduler = new DebounceScheduler(5);

            expect(scheduler.now()).to.equal(1000);
            mock.timers.tick(25);
            expect(scheduler.now()).to.equal(1025);

            scheduler.dispose();
        });
    });

    describe('ManualDebounceScheduler', () => {
        it('holds the callback until flushed, then awaits it', async () => {
            const scheduler = new ManualDebounceScheduler();
            let ran = false;

            scheduler.debounce(async () => {
                await delay(1);
                ran = true;
            });

            expect(scheduler.hasPending).to.be.true;
            expect(ran).to.be.false;

            await scheduler.flush();

            expect(ran).to.be.true;
            expect(scheduler.hasPending).to.be.false;
        });

        it('keeps only the most recent callback', async () => {
            const scheduler = new ManualDebounceScheduler();
            const ran: string[] = [];

            scheduler.debounce(() => { ran.push('first'); });
            scheduler.debounce(() => { ran.push('second'); });
            await scheduler.flush();

            expect(ran).to.deep.equal(['second']);
            expect(scheduler.debounce.mock.callCount()).to.equal(2);
        });

        it('rejects when flushing with nothing pending', async () => {
            const scheduler = new ManualDebounceScheduler();
            await expect(scheduler.flush()).to.be.rejectedWith(/No callback is pending/);
        });

        it('drops the pending callback on dispose', () => {
            const scheduler = new ManualDebounceScheduler();

            scheduler.debounce(() => undefined);
            scheduler.dispose();

            expect(scheduler.hasPending).to.be.false;
        });

        it('holds a frozen clock that only advance() moves', () => {
            const scheduler = new ManualDebounceScheduler();

            expect(scheduler.now()).to.equal(0);
            scheduler.advance(1500);
            expect(scheduler.now()).to.equal(1500);
        });
    });
});
