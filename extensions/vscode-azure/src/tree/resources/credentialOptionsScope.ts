/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CredentialFactoryOptions } from '@microsoft/vscode-azure-azutils';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Ambient, async-scoped {@linkcode CredentialFactoryOptions} applied to
 * credential acquisition performed within the current logical call chain.
 *
 * This lets a caller influence *how* a credential is obtained -- for example
 * requesting a silent acquisition (`{ sessionOptions: { silent: true } }`) so a
 * bulk discovery drill fails fast instead of prompting interactive sign-in --
 * without threading an explicit option through the generic tree layer
 * (`DataItemTree` / `DataProvider` / `drillChildren`). Those signatures stay
 * untouched; only the two collaborators that care -- the caller that opens the
 * scope and {@linkcode AzureAccountDataProvider} that reads it when building a
 * credential -- participate. The tradeoff is implicit context: the options are
 * only observed while control flow remains inside the
 * {@linkcode runWithCredentialOptions} callback and its awaited continuations.
 */
const credentialOptionsStorage = new AsyncLocalStorage<CredentialFactoryOptions>();

/**
 * Run `fn` inside a scope where {@linkcode getAmbientCredentialOptions} returns
 * the supplied `options`.
 *
 * The options remain active for the synchronous portion of `fn` and every
 * `await` continuation chained from it, so an `async` `fn` keeps the scope
 * active until its returned promise settles. This is what lets a bulk
 * discovery drill (which internally awaits provider fetches that build
 * credentials) apply the options throughout.
 *
 * Scopes nest by replacement: an inner call fully overrides the outer options
 * for its dynamic extent (they are not merged).
 *
 * @param options - The credential-factory options to make ambient.
 * @param fn - The function to run within the scope.
 * @returns Whatever `fn` returns (including a pending promise).
 */
export function runWithCredentialOptions<T>(options: CredentialFactoryOptions, fn: () => T): T {
    return credentialOptionsStorage.run(options, fn);
}

/**
 * The {@linkcode CredentialFactoryOptions} made ambient by an enclosing
 * {@linkcode runWithCredentialOptions} scope, or `undefined` when no scope is
 * active.
 *
 * Returning `undefined` outside any scope lets ordinary tree expansion and
 * other credential acquisition keep their default behavior.
 */
export function getAmbientCredentialOptions(): CredentialFactoryOptions | undefined {
    return credentialOptionsStorage.getStore();
}
