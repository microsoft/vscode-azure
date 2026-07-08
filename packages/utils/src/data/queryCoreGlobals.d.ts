/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// `@tanstack/query-core`'s shipped `.d.ts` references the DOM-lib type
// `VoidFunction`, but this package compiles with a Node-only `lib` (`ESNext`)
// and deliberately excludes the DOM lib so shared code can't reach for browser
// globals. Declaring the single missing alias in this ambient `.d.ts` satisfies
// the type checker program-wide without adding `DOM` to `lib`.
//
// This file has no top-level `import`/`export`, so it is an ambient script:
// TypeScript picks it up automatically for every compilation and the type is
// global, so no module needs to import it. (Adding an `import`/`export` here
// would turn it into a module and silently drop the global -- keep it bare.)

type VoidFunction = () => void;
