/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { CancellationError } from '../vscode/CancellationError';
import { toAbortSignal } from './toAbortSignal';

/**
 * Runs an operation, rejecting with {@linkcode CancellationError} when cancellation fires.
 *
 * An already-canceled source prevents the operation from starting. The normalized signal
 * is passed to the operation so it can stop its work; otherwise only the wait is canceled.
 * Late results are ignored and late rejections remain handled. Cancellation listeners
 * are released on every completion path.
 */
export async function withCancellation<T>(
    operation: (signal: AbortSignal | undefined) => PromiseLike<T>,
    cancellation?: vscode.CancellationToken | AbortSignal,
): Promise<T> {
    const { signal, disposable } = toAbortSignal(cancellation);
    let onCancel: (() => void) | undefined;
    try {
        if (signal?.aborted) {
            throw new CancellationError();
        }
        return await new Promise<T>((resolve, reject) => {
            onCancel = () => { reject(new CancellationError()); };
            signal?.addEventListener('abort', onCancel, { once: true });
            Promise.resolve(operation(signal)).then(resolve, reject);
        });
    } finally {
        if (onCancel) {
            signal?.removeEventListener('abort', onCancel);
        }
        disposable.dispose();
    }
}
