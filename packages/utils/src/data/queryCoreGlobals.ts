/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// `@tanstack/query-core`'s shipped `.d.ts` references the DOM-lib type
// `VoidFunction`, but this package compiles with a Node-only `lib` (`ESNext`)
// and deliberately excludes the DOM lib so shared code can't reach for browser
// globals. Declaring the single missing alias here (as a program-wide global
// augmentation) satisfies the type checker without adding `DOM` to `lib`.
// Modules that import query-core types import this module for its side effect so
// the augmentation is guaranteed to be part of the compilation.

export {};

declare global {
    type VoidFunction = () => void;
}
