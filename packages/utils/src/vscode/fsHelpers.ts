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
 * Returns the last path segment of {@linkcode uri}, used as a compact
 * display label (typically the folder name) in tree items.
 */
export function basename(uri: vscode.Uri): string {
    const segments = uri.path.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? uri.path;
}
