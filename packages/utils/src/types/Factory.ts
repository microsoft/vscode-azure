/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A factory function that synchronously creates a service instance.
 * Unlike inversify's `Factory<T>` (which returns `T | Promise<T>`),
 * this always returns a `T` so callers know they do not need to `await`
 * the result.
 */
export type SyncFactory<T, TArgs extends unknown[]> = (...args: TArgs) => T;

/**
 * A factory function that asynchronously creates a service instance.
 * Unlike inversify's `Factory<T>` (which returns `T | Promise<T>`),
 * this always returns a `Promise<T>` so callers know they must `await`
 * the result.
 */
export type AsyncFactory<T, TArgs extends unknown[]> = (...args: TArgs) => Promise<T>;
