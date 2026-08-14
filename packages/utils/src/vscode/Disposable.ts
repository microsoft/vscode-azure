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
     * Dispose everything that looks like a {@linkcode Disposable}, in the order given.
     *
     * Inputs are deliberately permissive: each argument may be a single disposable,
     * an array (nested arrays are flattened), `undefined`/`null`, or a value that has
     * no `dispose()` method at all. Anything that fails {@linkcode Disposable.test test}
     * is skipped rather than throwing, so callers can hand over loosely typed
     * collections without pre-filtering them.
     *
     * Errors thrown by an individual `dispose()` are swallowed so that one bad
     * disposable cannot prevent the rest from being torn down.
     *
     * @example
     * Disposable.disposeAll(this.subscription, this.disposables, maybeUndefined);
     */
    export function disposeAll(...disposables: readonly unknown[]): void {
        disposeEach(disposables);
    }

    function disposeEach(disposables: readonly unknown[]): void {
        for (const disposable of disposables) {
            if (Array.isArray(disposable)) {
                disposeEach(disposable as readonly unknown[]);
            } else if (test(disposable)) {
                try {
                    disposable.dispose();
                } catch {
                    // noop
                }
            }
        }
    }

    /**
     * Combine multiple disposables into one. Disposing the result
     * disposes each input in order via {@linkcode Disposable.disposeAll disposeAll},
     * so `undefined` entries are ignored and any errors thrown by individual
     * `dispose()` calls are swallowed.
     */
    export function from(...disposables: readonly (Disposable | undefined)[]): Disposable {
        return {
            dispose: () => {
                disposeAll(...disposables);
            },
        };
    }
}
