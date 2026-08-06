/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import type { IVsCode } from '../vscode/IVsCode';

/**
 * Open a settings document in the editor.
 *
 * Reuses the existing tab if the document is already open, because the URI identifies the
 * collection -- opening the same collection twice would otherwise give two views of one thing that
 * could disagree after a save.
 *
 * @returns the editor showing the document.
 */
export async function openSettingsDocument(code: IVsCode, uri: vscode.Uri): Promise<vscode.TextEditor> {
    const document = await code.workspace.openTextDocument(uri);
    return await code.window.showTextDocument(document, { preview: false });
}
