/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Ambient, async-scoped flag signalling that credential acquisition performed
 * within the current logical call chain should be *silent*: acquire a token
 * only from an existing cached session and fail fast (rather than prompting an
 * interactive sign-in) when none exists.
 *
 * This is deliberately implemented with {@linkcode AsyncLocalStorage} rather
 * than threading an explicit option through the generic tree layer
 * (`DataItemTree` / `DataProvider` / `drillChildren`). Those signatures stay
 * untouched; only the two collaborators that care -- the discovery caller that
 * opens the scope and {@linkcode AzureAccountDataProvider} that reads it when
 * building a credential -- participate. The tradeoff is implicit context: the
 * flag is only observed while control flow remains inside the
 * {@linkcode runWithSilentAuth} callback and its awaited continuations.
 */
const silentAuthStorage = new AsyncLocalStorage<boolean>();

/**
 * Run `fn` inside a scope where {@linkcode isSilentAuth} returns `true`.
 *
 * The flag remains active for the synchronous portion of `fn` and every
 * `await` continuation chained from it, so an `async` `fn` keeps the scope
 * active until its returned promise settles. This is what lets a bulk
 * discovery drill (which internally awaits provider fetches that build
 * credentials) run entirely silently.
 *
 * Scopes nest safely: an inner call simply re-establishes `true`.
 *
 * @param fn - The function to run within the silent-auth scope.
 * @returns Whatever `fn` returns (including a pending promise).
 */
export function runWithSilentAuth<T>(fn: () => T): T {
    return silentAuthStorage.run(true, fn);
}

/**
 * Whether the current async context is running inside a
 * {@linkcode runWithSilentAuth} scope.
 *
 * Returns `false` outside any such scope, so all ordinary tree expansion and
 * other credential acquisition keep their default interactive behavior.
 */
export function isSilentAuth(): boolean {
    return silentAuthStorage.getStore() === true;
}
