/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Disposable } from '../vscode/Disposable';

/**
 * A subscribable event, structurally compatible with both `vscode.Event`
 * and `vscode-jsonrpc`'s event shape.
 *
 * @remarks
 * Registering a listener returns a {@linkcode Disposable} that removes it.
 */
export type EventLike<T> = (listener: (e: T) => unknown, thisArgs?: unknown, disposables?: Disposable[]) => Disposable;

/**
 * A cancellation token, structurally compatible with `vscode.CancellationToken`.
 *
 * @remarks
 * Defined locally so shared packages can accept cancellation tokens from either
 * `vscode` (extensions) or `vscode-jsonrpc` (VS ServiceHub workers) without a
 * runtime dependency on either module.
 */
export interface CancellationTokenLike {
    readonly isCancellationRequested: boolean;
    readonly onCancellationRequested: EventLike<void>;
}
