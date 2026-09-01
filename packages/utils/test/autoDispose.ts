/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Disposable } from '../src/vscode/Disposable';

/**
 * Adapt a {@linkcode Disposable} to the ECMAScript explicit resource management
 * protocol so a test can bind its lifetime to the enclosing block with `using`.
 *
 * Prefer this over an `afterEach` when a test creates something that holds an
 * open handle -- a timer, a watcher, a server -- because cleanup stays next to
 * creation and a leak can't outlive the test that caused it.
 *
 * The returned value is the same object. A value that already implements
 * `Symbol.dispose` is left untouched, so its own cleanup still runs.
 *
 * @example
 * ```ts
 * it('should poll until the deployment finishes', async () => {
 *     using provider = autoDispose(new ArmDeploymentDataProvider(...));
 *     // ...disposed when this test's body exits, however it exits.
 * });
 * ```
 */
export function autoDispose<T extends Disposable>(value: T): T & globalThis.Disposable {
    if (Symbol.dispose in value) {
        return value as T & globalThis.Disposable;
    }

    return Object.assign(value, { [Symbol.dispose]: () => { value.dispose(); } });
}
