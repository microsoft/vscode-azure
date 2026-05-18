/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IVsCode } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';

/**
 * Shared helpers used by workspace data providers.
 *
 * Kept deliberately small -- providers handle their own detection
 * logic and only share these low-level filesystem helpers.
 */

/**
 * Returns `true` when `uri` exists on disk (as a file or directory).
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
 * Walks the currently-open workspace folders (zero or more) and yields
 * each folder's URI. When no workspace is open, yields nothing.
 *
 * Centralised so a future change (e.g. recursing into nested folders)
 * affects every provider consistently.
 */
export function getWorkspaceFolders(code: IVsCode): readonly vscode.WorkspaceFolder[] {
    return code.workspace.workspaceFolders ?? [];
}

/**
 * Returns the last path segment of `uri`, used as a compact description
 * (typically the folder name) in tree items.
 */
export function basename(uri: vscode.Uri): string {
    const segments = uri.path.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? uri.path;
}
