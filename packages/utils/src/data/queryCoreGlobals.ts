/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// `@tanstack/query-core`'s shipped `.d.ts` references the type `VoidFunction`,
// which TypeScript declares only in the browser-facing libs (`DOM` /
// `WebWorker`), not in the Node-only `lib` this package compiles with
// (`ESNext`). The Node lib is deliberate: excluding the browser libs keeps
// shared code from silently reaching for globals (`window`, `self`,
// `importScripts`, ...) that don't exist in the VS Code (Node) extension host.
// Declaring the single missing alias here satisfies the type checker without
// widening `lib` and losing that guardrail.
//
// This is an `interface` (not a `type VoidFunction = () => void`) on purpose: if
// a future browser/web-worker target adds `DOM`/`WebWorker` to its `lib` for
// that build, this identical `interface VoidFunction { (): void; }` *merges*
// with the lib's own declaration, whereas a `type` alias would collide with it
// (`error TS2300: Duplicate identifier 'VoidFunction'`). The interface form thus
// works today under `ESNext`-only and stays compatible with a later web build.
// The right lib for the VS Code web extension host is `WebWorker` (its host is a
// Web Worker with no DOM), and it -- like `DOM` -- also defines `VoidFunction`;
// so when that target is real, prefer a dedicated per-target tsconfig over
// adding a browser lib to the shared base.
//
// This must be a *module* with a `declare global` block (not a bare ambient
// `.d.ts`): an ambient `.d.ts` is only visible to the compilation whose
// `include` globs cover it, so it would not reach the extension, which
// type-checks this package via path-mapped source. A `declare global` in a
// module, by contrast, travels through the import graph -- the side-effect
// `import '../data/queryCoreGlobals'` in `DataItemTree.ts` pulls it into every
// program that reaches query-core's types (utils, azutils, and the extension).
declare global {
    // The interface (not a function-type alias) is intentional: an identical
    // `interface VoidFunction { (): void; }` *merges* with the DOM/WebWorker
    // lib's own declaration in a future web build instead of colliding (TS2300);
    // see the note above.
    interface VoidFunction {
        // eslint-disable-next-line @typescript-eslint/prefer-function-type -- interface is required for declaration merging, see above.
        (): void;
    }
}

export {};
