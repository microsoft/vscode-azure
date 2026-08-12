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
     */
    debounce(callback: () => void | Promise<void>): void;
}

/** Wall-clock {@linkcode IDebounceScheduler} backed by {@linkcode Debouncer}. */
export class DebounceScheduler implements IDebounceScheduler {
    private readonly debouncer = new Debouncer();

    /**
     * @param delayMs - Quiet period before the latest callback runs.
     * @param key - Debounce key, only relevant if a {@linkcode Debouncer} is ever shared.
     */
    public constructor(
        private readonly delayMs: number,
        private readonly key: DebounceKey = Symbol('DebounceScheduler'),
    ) { }

    /** @inheritdoc */
    public debounce(callback: () => void | Promise<void>): void {
        this.debouncer.debounce(this.key, this.delayMs, () => {
            void callback();
        });
    }

    public dispose(): void {
        this.debouncer.dispose();
    }
}
