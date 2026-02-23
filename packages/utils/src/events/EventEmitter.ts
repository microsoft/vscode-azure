/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter as NodeEventEmitter } from 'node:events';
import type * as vscode from 'vscode';
import type { AssertAssignable } from '../types/AssertAssignable';
import type { Disposable } from '../types/Disposable';

const EventName = 'e' as const;

/**
 * A function that represents an event to which you subscribe by calling it with
 * a listener. Mirrors `vscode.Event<T>`.
 */
export type Event<T> = (
    listener: (e: T) => void,
    thisArgs?: unknown,
    disposables?: Disposable[],
) => Disposable;

/**
 * A typed event emitter backed by Node's built-in `EventEmitter`.
 *
 * Implements the same interface as `vscode.EventEmitter<T>` so it can be used
 * as a drop-in replacement in contexts where the VS Code API is not available
 * (unit tests, shared packages, etc.).
 */
export class EventEmitter<T> implements Disposable {
    private readonly emitter = new NodeEventEmitter();

    /**
     * The event that listeners subscribe to. Calling `this.event(fn)` registers
     * `fn` and returns a {@link Disposable} that removes it.
     */
    public readonly event: Event<T> = (
        listener: (e: T) => void,
        thisArgs?: unknown,
        disposables?: Disposable[],
    ): Disposable => {
        const bound = thisArgs ? listener.bind(thisArgs) : listener;
        this.emitter.on(EventName, bound);

        const disposable: Disposable = {
            dispose: () => {
                this.emitter.removeListener(EventName, bound);
            },
        };

        if (disposables) {
            disposables.push(disposable);
        }

        return disposable;
    };

    /**
     * Fire the event, notifying all listeners with `data`.
     *
     * If a listener throws, the error is silently caught so that remaining
     * listeners are still called -- matching `vscode.EventEmitter` semantics.
     */
    public fire(data: T): void {
        const listeners = this.emitter.listeners(EventName);
        for (const listener of listeners) {
            try {
                (listener as (data: T) => void)(data);
            } catch {
                // Swallow -- VS Code's Emitter routes to onUnexpectedError,
                // which never re-throws from fire().
            }
        }
    }

    /** Remove all listeners. */
    public dispose(): void {
        this.emitter.removeAllListeners(EventName);
    }
}

// Compile-time checks: our EventEmitter is assignable to vscode.EventEmitter.
/* eslint-disable @typescript-eslint/no-unused-vars */
type CheckEvent = AssertAssignable<vscode.Event<unknown>, Event<unknown>>;
type CheckEventEmitter = AssertAssignable<vscode.EventEmitter<unknown>, EventEmitter<unknown>>;
/* eslint-enable @typescript-eslint/no-unused-vars */
