/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { withCancellation } from './withCancellation';

/**
 * Returns a promise that resolves after {@linkcode ms} milliseconds.
 *
 * If the optional {@linkcode cancellation} source (either a
 * {@linkcode vscode.CancellationToken CancellationToken} or an
 * {@linkcode AbortSignal}) fires -- or has already fired -- the promise
 * rejects as described by {@linkcode withCancellation}.
 */
export async function delay(ms: number, cancellation?: vscode.CancellationToken | AbortSignal): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await withCancellation(() => new Promise<void>(resolve => {
            timer = setTimeout(resolve, ms);
        }), cancellation);
    } finally {
        clearTimeout(timer);
    }
}
