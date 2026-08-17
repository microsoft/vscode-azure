/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IVsCode } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';

/** File name used for Static Web Apps database connections. */
export const StaticWebAppDatabaseConfigFileName = 'staticwebapp.database.config.json';

/**
 * Finds `*\/staticwebapp.database.config.json` exactly one directory below a workspace root.
 *
 * `node_modules` is never searched. The containing directory URI is returned
 * because that is the value expected by the SWA CLI's `--data-api-location`.
 *
 * @remarks
 * This hand-rolled one-level walk exists only because the monorepo has no
 * shared workspace scanning service yet; replace it with the shared, bounded
 * project detection service once it lands (see
 * https://github.com/microsoft/vscode-azure/issues/255).
 */
export async function getFolderContainingDatabaseConfig(
    code: IVsCode,
    workspaceFolder: vscode.Uri,
): Promise<vscode.Uri | undefined> {
    const rootEntries = await code.workspace.fs.readDirectory(workspaceFolder);
    for (const [name, type] of rootEntries) {
        if (name.toLowerCase() === 'node_modules' || !(type & code.FileType.Directory)) {
            continue;
        }

        const directory = code.Uri.joinPath(workspaceFolder, name);
        let entries: readonly [string, vscode.FileType][];
        try {
            entries = await code.workspace.fs.readDirectory(directory);
        } catch (error) {
            if (isFileNotFound(error)) {
                continue;
            }
            throw error;
        }

        if (entries.some(([entryName, entryType]) =>
            entryName === StaticWebAppDatabaseConfigFileName
            && !!(entryType & code.FileType.File))) {
            return directory;
        }
    }

    return undefined;
}

function isFileNotFound(error: unknown): boolean {
    return !!error
        && typeof error === 'object'
        && 'code' in error
        && error.code === 'FileNotFound';
}
