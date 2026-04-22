/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Minimal stand-in for `vscode.Uri` used by {@linkcode createMockVsCode}.
 *
 * Only implements the subset of `Uri` relied on by code under test:
 * `scheme`, `path`, `fsPath`, `toString()`, and the static `file` /
 * `joinPath` factories.
 */
export class MockUri {
    constructor(
        public readonly scheme: string,
        public readonly path: string,
        public readonly fsPath: string = path,
    ) { }
    /** Returns `scheme://path`. */
    toString() { return `${this.scheme}://${this.path}`; }
    /** Creates a `file:` scheme {@linkcode MockUri} for the given path. */
    static file(path: string) { return new MockUri('file', path); }
    /** Joins additional path segments onto `base` using `/` as separator. */
    static joinPath(base: MockUri, ...segments: string[]) {
        return new MockUri(base.scheme, [base.path, ...segments].join('/'));
    }
}
