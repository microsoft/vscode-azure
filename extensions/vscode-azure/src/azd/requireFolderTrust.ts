/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IVsCode } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';
import { requireWorkspaceTrust } from '../utils/workspaceTrust';
import type { ITempDirManager } from './TempDirManager';

/**
 * Requires workspace trust before tools run in, or files are written to,
 * {@linkcode folder}, unless the folder is one of the extension's own scratch
 * directories.
 *
 * Scratch directories hold only content the extension generated, so work there
 * is safe in an untrusted workspace. Any other folder is treated as workspace
 * content.
 *
 * @throws {@linkcode ExternalError} when the workspace is untrusted and
 * {@linkcode folder} is not a temp directory.
 */
export function requireFolderTrust(code: IVsCode, tempDirs: ITempDirManager, folder: vscode.Uri): void {
    if (!tempDirs.isTempDir(folder)) {
        requireWorkspaceTrust(code);
    }
}
