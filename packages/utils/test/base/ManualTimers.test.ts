/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ManualTimers } from '../ManualTimers';

/** Yields to the real event loop, which the fake `setTimeout` does not intercept. */
function realTurn(): Promise<void> {
    return new Promise<void>(resolve => setImmediate(resolve));
}

/**
 * {@linkcode ManualTimers} exists to keep timing tests from silently racing, so
 * a defect in it would not fail loudly -- it would hand every consumer back the
 * flakiness the helper was written to remove. These cover the contract that
 * consumers actually lean on.
 */
describe('ManualTimers (unit)', () => {
    const timers = new ManualTimers();

    beforeEach(() => {
        timers.enable();
    });

    afterEach(() => {
        timers.reset();
    });

    it('should not resolve whenScheduled until a timer is actually armed', async () => {
        let resolved = false;
        void timers.whenScheduled().then(() => { resolved = true; });

        await realTurn();
        expect(resolved, 'resolved before any timer was armed').to.be.false;

        setTimeout(() => { /* armed */ }, 1000);
        await realTurn();
        expect(resolved).to.be.true;
    });

    it('should resolve whenScheduled immediately when a timer is already armed', async () => {
        setTimeout(() => { /* armed */ }, 1000);

        await timers.whenScheduled();
        expect(timers.hasPending).to.be.true;
    });

    it('should wait for the next arm rather than resolving off a fired timer', async () => {
        // Both poll-timing consumers advance the clock and then await the next
        // arm, so a fired timer must stop counting as pending.
        setTimeout(() => { /* fires below */ }, 1000);
        await timers.whenScheduled();

        timers.tick(1000);
        expect(timers.hasPending, 'a fired timer still counted as pending').to.be.false;

        let resolved = false;
        void timers.whenScheduled().then(() => { resolved = true; });
        await realTurn();
        expect(resolved, 'resolved off the timer that already fired').to.be.false;

        setTimeout(() => { /* the next arm */ }, 500);
        await realTurn();
        expect(resolved).to.be.true;
    });

    it('should stop tracking a timer that was cleared before firing', async () => {
        const handle = setTimeout(() => { /* never fires */ }, 1000);
        await timers.whenScheduled();

        clearTimeout(handle);

        expect(timers.hasPending).to.be.false;
    });

    it('should fire armed callbacks when the clock advances past them', () => {
        let fired = 0;
        setTimeout(() => { fired++; }, 1000);

        timers.tick(999);
        expect(fired).to.equal(0);

        timers.tick(1);
        expect(fired).to.equal(1);
    });

    it('should restore the real timers on reset', () => {
        const fake = globalThis.setTimeout;
        timers.reset();
        expect(globalThis.setTimeout).to.not.equal(fake);

        // Leave the fakes installed for the shared afterEach.
        timers.enable();
    });

    it('should reject a second enable while already installed', () => {
        expect(() => { timers.enable(); }).to.throw('already enabled');
    });
});
