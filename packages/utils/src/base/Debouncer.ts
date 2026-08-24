/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Disposable } from '../vscode/Disposable';

/**
 * A key identifying an independent debounce timer. Each distinct key has its own
 * pending timer, so callbacks for different keys never interfere with one
 * another.
 */
export type DebounceKey = string | symbol;

/**
 * Coalesces bursts of calls into a single delayed callback, keyed so unrelated
 * streams of events can be debounced independently by the same instance.
 *
 * For a given {@linkcode DebounceKey key}, each call to {@linkcode debounce}
 * resets that key's timer; the most recently supplied callback runs once the key
 * has been quiet for the requested delay. Keys are independent -- scheduling or
 * firing one key never affects another.
 *
 * The owner is responsible for the lifetime of the debouncer: call
 * {@linkcode dispose} (or {@linkcode cancel} per key) to clear pending timers so
 * callbacks don't fire after the owner is torn down.
 */
export class Debouncer implements Disposable {
    private readonly timers = new Map<DebounceKey, ReturnType<typeof setTimeout>>();

    /**
     * Schedule {@linkcode callback} to run after {@linkcode ms} milliseconds of
     * quiescence for {@linkcode key}. Repeated calls with the same key before the
     * delay elapses reset the timer and replace the pending callback, so only the
     * most recent callback runs once the burst settles.
     *
     * @param key - Identifies the independent timer to (re)schedule.
     * @param ms - Quiet period, in milliseconds, before the callback fires.
     * @param callback - Invoked once the key has been idle for {@linkcode ms}.
     */
    public debounce(key: DebounceKey, ms: number, callback: () => void): void {
        this.cancel(key);

        const timer = setTimeout(() => {
            this.timers.delete(key);
            callback();
        }, ms);

        this.timers.set(key, timer);
    }

    /**
     * Cancel any pending callback for {@linkcode key}. No-op if nothing is
     * scheduled for the key.
     */
    public cancel(key: DebounceKey): void {
        const existing = this.timers.get(key);
        if (existing !== undefined) {
            clearTimeout(existing);
            this.timers.delete(key);
        }
    }

    /** Cancel every pending callback across all keys. */
    public dispose(): void {
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
    }
}
