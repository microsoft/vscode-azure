/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Utility type for asserting that one type is assignable to another.
 * If the assertion fails, a compile error will occur.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type AssertAssignable<Target, Source extends Target> = never;
