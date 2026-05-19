/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';

/**
 * Minimal stand-in for `vscode.Uri` used by {@linkcode createMockVsCode}.
 *
 * Implements the full `Uri` instance API (`scheme`, `path`, `fsPath`,
 * `authority`, `query`, `fragment`, `toString()`, `toJSON()`, `with()`)
 * and the static factories (`file`, `parse`, `from`, `joinPath`).
 */
export class MockUri implements vscode.Uri {
    constructor(
        public readonly scheme: string,
        public readonly path: string,
        public readonly fsPath: string = path,
        public readonly authority: string = '',
        public readonly query: string = '',
        public readonly fragment: string = '',
    ) { }

    /** Returns a new {@linkcode MockUri} with the given component overrides. */
    with(change: { scheme?: string; authority?: string; path?: string; query?: string; fragment?: string }) {
        return new MockUri(
            change.scheme ?? this.scheme,
            change.path ?? this.path,
            change.path ?? this.fsPath,
            change.authority ?? this.authority,
            change.query ?? this.query,
            change.fragment ?? this.fragment,
        );
    }

    /** Returns a JSON representation of this URI. */
    toJSON() {
        return { scheme: this.scheme, authority: this.authority, path: this.path, query: this.query, fragment: this.fragment };
    }

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

    /** Creates a {@linkcode MockUri} from component parts. */
    static from(components: { scheme: string; authority?: string; path?: string; query?: string; fragment?: string }) {
        const path = components.path ?? '';
        return new MockUri(components.scheme, path, path, components.authority ?? '', components.query ?? '', components.fragment ?? '');
    }

    /** Joins additional path segments onto `base` using `/` as separator. */
    static joinPath(base: MockUri, ...segments: string[]) {
        const joined = [base.path, ...segments].join('/');
        return new MockUri(base.scheme, joined, joined, base.authority);
    }
}
