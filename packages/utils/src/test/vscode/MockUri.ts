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
        public readonly authority: string = '',
        public readonly query: string = '',
        public readonly fragment: string = '',
    ) { }
    /** Returns the URI as a string in `scheme://authority/path?query#fragment` form. */
    toString() {
        let result = `${this.scheme}://`;
        if (this.authority) {
            result += this.authority;
        }
        result += this.path;
        if (this.query) {
            result += `?${this.query}`;
        }
        if (this.fragment) {
            result += `#${this.fragment}`;
        }
        return result;
    }
    /** Creates a `file:` scheme {@linkcode MockUri} for the given path. */
    static file(path: string) { return new MockUri('file', path); }
    /** Parses a URI string into a {@linkcode MockUri}. */
    static parse(value: string) {
        try {
            const url = new URL(value);
            return new MockUri(
                url.protocol.replace(/:$/, ''),
                url.pathname,
                url.pathname,
                url.host,
                url.search.replace(/^\?/, ''),
                url.hash.replace(/^#/, ''),
            );
        } catch {
            return new MockUri('', value);
        }
    }
    /** Joins additional path segments onto `base` using `/` as separator. */
    static joinPath(base: MockUri, ...segments: string[]) {
        const joined = [base.path, ...segments].join('/');
        return new MockUri(base.scheme, joined, joined, base.authority);
    }
}
