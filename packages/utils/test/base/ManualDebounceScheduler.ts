/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mock } from 'node:test';
import type { IDebounceScheduler } from '../../src/base/IDebounceScheduler';

/**
 * An {@linkcode IDebounceScheduler} the test drives by hand.
 *
 * Holds the most recently scheduled callback instead of arming a timer, so a
 * test can assert that work *was* scheduled and then await it to completion
 * with {@linkcode flush}. This avoids coordinating fake timers with real
 * promise continuations, which interleave unpredictably and make such tests
 * flaky.
 */
export class ManualDebounceScheduler implements IDebounceScheduler {
    private pending: (() => void | Promise<void>) | undefined;
    private currentTime = 0;

    public readonly debounce = mock.fn((callback: () => void | Promise<void>) => {
        // Replacing rather than queueing mirrors real debounce semantics: a
        // burst collapses to one run.
        this.pending = callback;
    });

    public readonly dispose = mock.fn(() => {
        this.pending = undefined;
    });

    /** Frozen clock, moved only by {@linkcode advance}. Starts at 0. */
    public readonly now = mock.fn(() => this.currentTime);

    /** Moves {@linkcode now} forward, for asserting time-window behavior. */
    public advance(ms: number): void {
        this.currentTime += ms;
    }

    /** Whether a callback is currently scheduled. */
    public get hasPending(): boolean {
        return this.pending !== undefined;
    }

    /**
     * Runs the pending callback and awaits it.
     *
     * @throws if nothing is scheduled, so a test cannot silently pass by
     *   flushing work that was never queued.
     */
    public async flush(): Promise<void> {
        const callback = this.pending;
        if (!callback) {
            throw new Error('No callback is pending');
        }

        this.pending = undefined;
        await callback();
    }
}
