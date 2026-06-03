/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { URI, Utils } from 'vscode-uri';
import type { Satisfies } from '../../types/Satisfies';

/**
 * A faithful stand-in for `vscode.Uri`, backed by the Microsoft-published
 * `vscode-uri` package (the same `URI` implementation the editor ships).
 *
 * @remarks
 * Instances returned by {@linkcode MockUri.file}, {@linkcode MockUri.parse},
 * etc. are real `vscode-uri` `URI` objects, so percent-encoding, `fsPath`
 * normalization (drive letters, UNC paths, platform separators), and
 * round-tripping all match the editor exactly -- unlike a hand-rolled mock.
 *
 * The only adaptation is {@linkcode MockUri.joinPath}, which `vscode-uri`
 * exposes as `Utils.joinPath` rather than a static on `URI`; it is re-shaped
 * here to match `vscode.Uri.joinPath`. Use {@linkcode MockUri.isUri} rather
 * than `instanceof` to test for URI-ness.
 */
export const MockUri = {
    isUri: (thing: unknown): thing is vscode.Uri => URI.isUri(thing),
    parse: (value: string, strict?: boolean): vscode.Uri => URI.parse(value, strict),
    file: (path: string): vscode.Uri => URI.file(path),
    from: (components: { scheme: string; authority?: string; path?: string; query?: string; fragment?: string }): vscode.Uri => URI.from(components),
    joinPath: (base: vscode.Uri, ...pathSegments: string[]): vscode.Uri =>
        Utils.joinPath(URI.isUri(base) ? base : URI.from(base), ...pathSegments),
} as unknown as typeof vscode.Uri;

// Compile-time checks: vscode-uri's URI instances are mutually assignable to
// vscode.Uri, so the instances handed back by `Uri.*` are faithful.
/* eslint-disable @typescript-eslint/no-unused-vars */
type ForwardCheckUri = Satisfies<URI, vscode.Uri>;
type ReverseCheckUri = Satisfies<vscode.Uri, URI>;
/* eslint-enable @typescript-eslint/no-unused-vars */
