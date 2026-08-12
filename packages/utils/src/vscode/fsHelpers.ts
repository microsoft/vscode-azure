/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import type { IVsCode } from './IVsCode';

/**
 * Returns `true` when {@linkcode uri} exists on disk (as a file or directory).
 * Swallows the FS error so callers can treat the result as a boolean.
 */
export async function fileExists(code: IVsCode, uri: vscode.Uri): Promise<boolean> {
    try {
        await code.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

/**
 * Returns `true` when `error` is the filesystem error raised for a missing
 * file or directory.
 *
 * Useful for telling an expected race (something deleted while it was being
 * enumerated) apart from a real failure such as a permissions error, which
 * should not be swallowed.
 */
export function isFileNotFoundError(error: unknown): boolean {
    return error !== null
        && typeof error === 'object'
        && 'code' in error
        && error.code === 'FileNotFound';
}

/**
 * Returns the POSIX-style path of {@linkcode uri} relative to
 * {@linkcode base}, or `undefined` when `uri` is not inside `base`.
 *
 * Returns an empty string when the two refer to the same location. Compares
 * paths only, so both should share a scheme and authority.
 */
export function relativePath(base: vscode.Uri, uri: vscode.Uri): string | undefined {
    const basePath = base.path.replace(/\/+$/, '');
    if (uri.path === basePath) {
        return '';
    }
    return uri.path.startsWith(`${basePath}/`)
        ? uri.path.slice(basePath.length + 1)
        : undefined;
}

/**
 * Returns the last path segment of {@linkcode uri}, used as a compact
 * display label (typically the folder name) in tree items.
 */
export function basename(uri: vscode.Uri): string {
    const segments = uri.path.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? uri.path;
}
