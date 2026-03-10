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
    public constructor(message?: string, public readonly stepName?: string) {
        super(message ?? CanceledName);
        this.name = CanceledName;
    }

    public static test(error: unknown): error is CancellationError {
        // TODO: add a test case to ensure VSCode team doesn't change their error's name?
        return error instanceof CancellationError || (error instanceof Error && (error.name === CanceledName || error.name === 'Cancelled'));
    }
}

const CanceledName = 'Canceled'; // VS Code's error uses this spelling and we need to match. https://github.com/microsoft/vscode/blob/ff7ffa542f145bbd0bad82c38ed1ba1c54f72ec3/src/vs/base/common/errors.ts#L196
