/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { CancellationError } from '../vscode/CancellationError';

/**
 * Returns a promise that resolves after {@linkcode ms} milliseconds.
 *
 * If the optional {@linkcode cancellation} source (either a
 * {@linkcode vscode.CancellationToken CancellationToken} or an
 * {@linkcode AbortSignal}) fires -- or has already fired -- the promise
 * rejects with {@linkcode CancellationError}.
 */
export function delay(ms: number, cancellation?: vscode.CancellationToken | AbortSignal): Promise<void> {
    const signal = cancellation instanceof AbortSignal ? cancellation : undefined;
    const token = cancellation instanceof AbortSignal ? undefined : cancellation;

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
