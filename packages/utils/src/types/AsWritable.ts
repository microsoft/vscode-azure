/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Simple helper type that just takes the `readonly` off all the properties in an object.
 */
export type AsWritable<T> = { -readonly [K in keyof T]: T[K] };
