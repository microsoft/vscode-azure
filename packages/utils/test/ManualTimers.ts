/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mock } from 'node:test';

type TimerCallback = (...args: unknown[]) => void;
type MockedSetTimeout = (callback: TimerCallback, ms?: number, ...args: unknown[]) => unknown;
type MockedClearTimeout = (handle: unknown) => void;

/**
 * Fake `setTimeout` a test can wait on before advancing.
 *
 * Wraps Node's {@linkcode mock.timers} (`setTimeout`/`clearTimeout` only) and
 * adds {@linkcode whenScheduled}, which resolves once a timer is armed.
 *
 * Advancing a fake clock only fires timers that already exist. Code that arms
 * its next timer from a promise continuation -- a poll loop, a retry, a
 * debounce chained off an await -- has not called `setTimeout` yet at the
 * moment the awaited work resolves, so a {@linkcode tick} issued then fires
 * nothing and the loop stalls until the test times out. Waiting for the arm
 * itself removes the race: the tick can never land early.
 *
 * @example
 * ```ts
 * const timers = new ManualTimers();
 * beforeEach(() => timers.enable());
 * afterEach(() => timers.reset());
 *
 * it('polls again after the interval', async () => {
 *     startPolling();
 *     await timers.whenScheduled();
 *     timers.tick(1000);
 * });
 * ```
 */
export class ManualTimers {
    /** One entry per armed, not-yet-fired timer. */
    private readonly pending = new Set<object>();
    /** Maps timer handles back to their {@linkcode pending} entry, so `clearTimeout` can retire them. */
    private readonly tokens = new Map<unknown, object>();
    private waiters: Array<() => void> = [];
    private enabled = false;

    /**
     * Installs the fake timers. Call from `beforeEach`, and pair with
     * {@linkcode reset}.
     *
     * @throws if the timers are already installed.
     */
    public enable(): void {
        if (this.enabled) {
            throw new Error('Timers are already enabled');
        }

        mock.timers.enable({ apis: ['setTimeout'] });
        this.enabled = true;

        const mockedSetTimeout = globalThis.setTimeout as unknown as MockedSetTimeout;
        const mockedClearTimeout = globalThis.clearTimeout as unknown as MockedClearTimeout;

        globalThis.setTimeout = ((callback: TimerCallback, ms?: number, ...args: unknown[]) => {
            const token = {};
            this.pending.add(token);

            const entry: { handle?: unknown } = {};
            entry.handle = mockedSetTimeout((...callbackArgs: unknown[]) => {
                this.retire(token, entry.handle);
                callback(...callbackArgs);
            }, ms, ...args);
            this.tokens.set(entry.handle, token);

            const waiters = this.waiters;
            this.waiters = [];
            waiters.forEach(resolve => { resolve(); });

            return entry.handle;
        }) as unknown as typeof globalThis.setTimeout;

        globalThis.clearTimeout = (handle: unknown) => {
            const token = this.tokens.get(handle);
            if (token) {
                this.retire(token, handle);
            }

            mockedClearTimeout(handle);
        };
    }

    /**
     * Uninstalls the fake timers and drops all pending state. Call from
     * `afterEach`.
     */
    public reset(): void {
        mock.timers.reset();
        this.pending.clear();
        this.tokens.clear();
        this.waiters = [];
        this.enabled = false;
    }

    /** Moves the fake clock forward, firing every timer that comes due. */
    public tick(ms: number): void {
        mock.timers.tick(ms);
    }

    /** Whether any armed timer has yet to fire. */
    public get hasPending(): boolean {
        return this.pending.size > 0;
    }

    /**
     * Resolves once a timer is armed, immediately if one already is.
     *
     * A timer that fires (or is cleared) stops counting, so awaiting this after
     * a {@linkcode tick} waits for the *next* arm rather than resolving off the
     * one just fired. Nothing bounds the wait: if the code under test never
     * arms another timer, the awaiting test hangs until its own timeout.
     */
    public whenScheduled(): Promise<void> {
        if (this.hasPending) {
            return Promise.resolve();
        }

        return new Promise<void>(resolve => this.waiters.push(resolve));
    }

    private retire(token: object, handle: unknown): void {
        this.pending.delete(token);
        if (handle !== undefined) {
            this.tokens.delete(handle);
        }
    }
}
