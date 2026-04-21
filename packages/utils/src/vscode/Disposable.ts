/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';

/**
 * An object with a `dispose()` method. Aliased to VS Code's
 * `vscode.Disposable` so shared packages can reference the type
 * without importing the `vscode` module.
 */
export type Disposable = vscode.Disposable;

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Disposable {
    /** A shared no-op {@linkcode Disposable}. */
    export const None: Disposable = { dispose: () => { /* noop */ } } satisfies vscode.Disposable; // The `satisfies` operator also makes sure the interfaces are compatible, without needing a `Satisfies` type check

    /** Type guard that returns `true` if `obj` has a callable `dispose` method. */
    export function test(obj: unknown): obj is Disposable {
        return !!obj && typeof obj === 'object' && 'dispose' in obj && typeof obj.dispose === 'function';
    }

    /**
     * Combine multiple disposables into one. Disposing the result
     * disposes each input in order; any errors thrown by individual
     * `dispose()` calls are swallowed.
     */
    export function from(...disposables: Disposable[]): Disposable {
        return {
            dispose: () => {
                for (const disposable of disposables) {
                    try {
                        disposable.dispose();
                    } catch {
                        // noop
                    }
                }
            },
        };
    }
}
