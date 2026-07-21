/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { CancellationError } from '../vscode/CancellationError';

/**
 * Options for {@linkcode delay}.
 */
export interface DelayOptions {
    /** An {@linkcode AbortSignal} that causes the delay to reject with {@linkcode CancellationError}. */
    readonly signal?: AbortSignal;
    /** A {@linkcode vscode.CancellationToken CancellationToken} that causes the delay to reject with {@linkcode CancellationError}. */
    readonly cancellationToken?: vscode.CancellationToken;
}

/**
 * Returns a promise that resolves after {@linkcode ms} milliseconds.
 *
 * If the optional {@linkcode DelayOptions.signal signal} or
 * {@linkcode DelayOptions.cancellationToken cancellationToken} fires
 * (or has already fired), the promise rejects with
 * {@linkcode CancellationError}.
 */
export function delay(ms: number, options?: DelayOptions): Promise<void> {
    const signal = options?.signal;
    const token = options?.cancellationToken;

    if (signal?.aborted || token?.isCancellationRequested) {
        return Promise.reject(new CancellationError());
    }

    return new Promise<void>((resolve, reject) => {
        const cleanup = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onCancel);
            ctDisposable?.dispose();
        };

        const onCancel = () => {
            cleanup();
            reject(new CancellationError());
        };

        const timer = setTimeout(() => {
            cleanup();
            resolve();
        }, ms);

        signal?.addEventListener('abort', onCancel, { once: true });
        const ctDisposable = token?.onCancellationRequested(onCancel);
    });
}
