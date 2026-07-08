/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// `@tanstack/query-core`'s shipped `.d.ts` references the DOM-lib type
// `VoidFunction`, but this package (and its consumers) compile with a Node-only
// `lib` (`ESNext`) that deliberately excludes the DOM lib so shared code can't
// reach for browser globals. Declaring the single missing alias here satisfies
// the type checker without adding `DOM` to `lib`.
//
// This must be a *module* with a `declare global` block (not a bare ambient
// `.d.ts`): an ambient `.d.ts` is only visible to the compilation whose
// `include` globs cover it, so it would not reach the extension, which
// type-checks this package via path-mapped source. A `declare global` in a
// module, by contrast, travels through the import graph -- the side-effect
// `import '../data/queryCoreGlobals'` in `DataItemTree.ts` pulls it into every
// program that reaches query-core's types (utils, azutils, and the extension).
declare global {
    type VoidFunction = () => void;
}

export {};
