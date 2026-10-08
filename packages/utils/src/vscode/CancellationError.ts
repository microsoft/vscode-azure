/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';

/**
 * An error type that signals cancellation of an operation.
 *
 * Compatible with VS Code's `vscode.CancellationError` without requiring
 * a runtime import of the `vscode` module.
 */
export class CancellationError extends Error implements vscode.CancellationError {
    /**
     * @param message Optional error message. Defaults to the name VS Code uses for its cancellation errors.
     * @param stepName Optional name of the wizard step or operation that was cancelled, for diagnostics.
     */
    public constructor(message?: string, public readonly stepName?: string) {
        super(message ?? CanceledName);
        this.name = CanceledName;
    }

    /**
     * Type guard that returns `true` if `error` is a cancellation --
     * either a {@linkcode CancellationError} instance or a standard
     * `Error` whose `name` matches the spelling VS Code uses.
     */
    public static test(error: unknown): error is CancellationError {
        return error instanceof CancellationError || (error instanceof Error && (error.name === CanceledName || error.name === 'Cancelled'));
    }

    /**
     * Throws a {@linkcode CancellationError} when the token or signal is cancelled.
     *
     * Does nothing when no cancellation source is supplied. Abort signals are
     * normalized regardless of their abort reason, so consumers can use
     * {@linkcode CancellationError.test} uniformly.
     *
     * @param stepName - Optional operation name carried on the error for diagnostics.
     */
    public static throwIfCancelled(token?: vscode.CancellationToken | AbortSignal, stepName?: string): void {
        if (token && ('aborted' in token ? token.aborted : token.isCancellationRequested)) {
            throw new CancellationError(undefined, stepName);
        }
    }
}

const CanceledName = 'Canceled'; // VS Code's error uses this spelling and we need to match. https://github.com/microsoft/vscode/blob/ff7ffa542f145bbd0bad82c38ed1ba1c54f72ec3/src/vs/base/common/errors.ts#L196

/**
 * Throws a {@linkcode CancellationError} if {@linkcode token} has been
 * cancelled, and does nothing otherwise.
 *
 * Long-running loops should call this at their await boundaries so
 * cancellation surfaces promptly and uniformly.
 *
 * @param stepName - Optional name of the operation being cancelled, carried on
 *   the error for diagnostics.
 */
export function throwIfCancelled(token: vscode.CancellationToken | undefined, stepName?: string): void {
    CancellationError.throwIfCancelled(token, stepName);
}

/**
 * Type guard for a {@linkcode vscode.CancellationToken CancellationToken}.
 *
 * Structural rather than `instanceof`, because VS Code exposes no constructor
 * to test against and a token may legitimately come from another extension
 * host or a test double. Use it when a token arrives from outside the
 * extension -- across a command boundary, say -- where an unchecked value
 * would otherwise surface as a failure much deeper in.
 */
export function isCancellationToken(value: unknown): value is vscode.CancellationToken {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const token = value as vscode.CancellationToken;
    return typeof token.isCancellationRequested === 'boolean'
        && typeof token.onCancellationRequested === 'function';
}
