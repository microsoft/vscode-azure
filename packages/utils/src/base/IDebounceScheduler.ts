/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ServiceIdentifier } from 'inversify';
import type { Disposable } from '../vscode/Disposable';
import { Debouncer, type DebounceKey } from './Debouncer';

export const IDebounceScheduler: ServiceIdentifier<IDebounceScheduler> = Symbol.for('IDebounceScheduler');

/**
 * Owns the timing of a single debounced stream of work.
 *
 * The production implementation debounces against wall-clock time. Tests can
 * inject a manually driven implementation and await the scheduled callback
 * directly, instead of coordinating fake timers with asynchronous work -- which
 * is brittle, because a faked timer callback and real promise continuations
 * interleave unpredictably.
 */
export interface IDebounceScheduler extends Disposable {
    /**
     * Replaces any pending callback, and runs the latest one once the quiet
     * period has elapsed.
     *
     * The callback runs detached from this call, so implementations must
     * contain its failures rather than letting them escape as uncaught
     * exceptions or unhandled rejections.
     */
    debounce(callback: () => void | Promise<void>): void;

    /**
     * Current epoch time, in milliseconds.
     *
     * Exposed here because a caller that debounces on this scheduler's clock
     * usually also compares timestamps against it (suppression windows,
     * cooldowns). Reading the time through the scheduler keeps both on one
     * clock, so a test that drives {@linkcode debounce} by hand can drive the
     * passage of time with it instead of reaching for fake timers.
     */
    now(): number;
}

/** Wall-clock {@linkcode IDebounceScheduler} backed by {@linkcode Debouncer}. */
export class DebounceScheduler implements IDebounceScheduler {
    private readonly debouncer = new Debouncer();

    /**
     * @param delayMs - Quiet period before the latest callback runs.
     * @param key - Debounce key, only relevant if a {@linkcode Debouncer} is ever shared.
     * @param onError - Notified when a debounced callback throws or rejects. Debounced work is
     *   best-effort, so the failure is contained either way; supply this to log it rather than
     *   lose it. Must not throw.
     */
    public constructor(
        private readonly delayMs: number,
        private readonly key: DebounceKey = Symbol('DebounceScheduler'),
        private readonly onError?: (error: unknown) => void,
    ) { }

    /** @inheritdoc */
    public now(): number {
        return Date.now();
    }

    /** @inheritdoc */
    public debounce(callback: () => void | Promise<void>): void {
        this.debouncer.debounce(this.key, this.delayMs, () => {
            // The callback runs from a timer, detached from any caller, so a sync throw or a
            // rejected promise would otherwise escape as an uncaught exception / unhandled
            // rejection and destabilize the extension host.
            try {
                void Promise.resolve(callback()).catch((error: unknown) => { this.handleError(error); });
            } catch (error) {
                this.handleError(error);
            }
        });
    }

    public dispose(): void {
        this.debouncer.dispose();
    }

    private handleError(error: unknown): void {
        this.onError?.(error);
    }
}
