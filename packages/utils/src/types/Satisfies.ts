/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Compile-time assertion that `Source` is assignable to `Target`.
 *
 * If `Source` is not assignable to `Target`, TypeScript reports an error.
 * This is a type-level helper, distinct from the `satisfies` value operator.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type Satisfies<Target, Source extends Target> = never;