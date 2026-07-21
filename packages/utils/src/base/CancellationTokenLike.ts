/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * An object with a `dispose()` method, structurally compatible with
 * `vscode.Disposable`. Used as the return type of {@linkcode EventLike}
 * subscriptions without requiring a runtime `vscode` import.
 */
export interface DisposableLike {
    dispose(): unknown;
}

/**
 * A subscribable event, structurally compatible with both `vscode.Event`
 * and `vscode-jsonrpc`'s event shape.
 *
 * @remarks
 * Registering a listener returns a {@linkcode DisposableLike} that removes it.
 */
export type EventLike<T> = (listener: (e: T) => unknown, thisArgs?: unknown, disposables?: DisposableLike[]) => DisposableLike;

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
