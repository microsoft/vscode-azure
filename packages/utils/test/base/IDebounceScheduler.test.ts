/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { DebounceScheduler } from '../../src/base/IDebounceScheduler';
import { delay } from '../../src/base/delay';
import { ManualDebounceScheduler } from './ManualDebounceScheduler';

describe('IDebounceScheduler (unit)', () => {
    describe('DebounceScheduler', () => {
        it('collapses a burst into a single run of the latest callback', async () => {
            const scheduler = new DebounceScheduler(5);
            const ran: string[] = [];

            scheduler.debounce(() => { ran.push('first'); });
            scheduler.debounce(() => { ran.push('second'); });
            scheduler.debounce(() => { ran.push('third'); });

            await delay(40);
            expect(ran).to.deep.equal(['third']);

            scheduler.dispose();
        });

        it('does not run a pending callback after dispose', async () => {
            const scheduler = new DebounceScheduler(5);
            let ran = false;

            scheduler.debounce(() => { ran = true; });
            scheduler.dispose();

            await delay(40);
            expect(ran).to.be.false;
        });

        it('contains a synchronous throw and reports it', async () => {
            const errors: unknown[] = [];
            const scheduler = new DebounceScheduler(5, undefined, error => errors.push(error));
            const boom = new Error('boom');

            scheduler.debounce(() => { throw boom; });

            await delay(40);
            expect(errors).to.deep.equal([boom]);

            scheduler.dispose();
        });

        it('contains a rejected promise and reports it', async () => {
            const errors: unknown[] = [];
            const scheduler = new DebounceScheduler(5, undefined, error => errors.push(error));
            const boom = new Error('boom');

            scheduler.debounce(() => Promise.reject(boom));

            await delay(40);
            expect(errors).to.deep.equal([boom]);

            scheduler.dispose();
        });

        it('keeps working after a failed run', async () => {
            const scheduler = new DebounceScheduler(5);
            let ran = false;

            scheduler.debounce(() => Promise.reject(new Error('boom')));
            await delay(40);

            scheduler.debounce(() => { ran = true; });
            await delay(40);

            expect(ran).to.be.true;

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
    });
});
