/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { Disposable } from '../vscode/Disposable';

/**
 * Result of {@linkcode toAbortSignal}: a normalized {@linkcode AbortSignal} (or
 * `undefined` when no cancellation source was supplied) plus a
 * {@linkcode Disposable} that releases any listener the bridge established.
 */
export interface AbortSignalBridge {
    readonly signal: AbortSignal | undefined;
    readonly disposable: Disposable;
}

/**
 * Normalizes an optional cancellation source into an {@linkcode AbortSignal}
 * suitable for handing to APIs that speak the DOM abort protocol (e.g.
 * {@linkcode nano-spawn}).
 *
 * @remarks
 * - `undefined` yields no signal and {@linkcode Disposable.None}.
 * - An {@linkcode AbortSignal} is passed through unchanged; the caller owns its
 *   lifetime, so the returned {@linkcode Disposable} is {@linkcode Disposable.None}.
 * - A {@linkcode vscode.CancellationToken CancellationToken} is bridged onto a
 *   fresh {@linkcode AbortController}. If the token is already cancelled the
 *   returned signal starts aborted; otherwise disposing unsubscribes the token
 *   listener.
 */
export function toAbortSignal(cancellation?: vscode.CancellationToken | AbortSignal): AbortSignalBridge {
    if (!cancellation) {
        return { signal: undefined, disposable: Disposable.None };
    }

    if (cancellation instanceof AbortSignal) {
        return { signal: cancellation, disposable: Disposable.None };
    }

    const controller = new AbortController();
    if (cancellation.isCancellationRequested) {
        controller.abort();
        return { signal: controller.signal, disposable: Disposable.None };
    }

    const disposable = cancellation.onCancellationRequested(() => { controller.abort(); });
    return { signal: controller.signal, disposable };
}
