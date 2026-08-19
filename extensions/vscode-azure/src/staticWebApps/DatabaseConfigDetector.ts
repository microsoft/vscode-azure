/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IVsCode } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';
import { walkDirectory } from '../utils/workspaceIndex/walkWorkspace';

/** File name used for Static Web Apps database connections. */
export const StaticWebAppDatabaseConfigFileName = 'staticwebapp.database.config.json';

/**
 * Finds the folder holding `staticwebapp.database.config.json` beneath a root.
 *
 * The containing directory URI is returned because that is the value the SWA
 * CLI's `--data-api-location` expects.
 *
 * @remarks
 * Traversal is the shared {@linkcode walkDirectory}, so generated output and
 * dependency directories are skipped and the walk is bounded. It is
 * breadth-first, so the shallowest config wins when a project has more than one
 * -- which keeps a fixture or sample nested deep in the tree from shadowing the
 * project's own.
 *
 * The root itself is not a candidate: the CLI serves the app from the root and
 * the data API from a separate folder.
 */
export async function getFolderContainingDatabaseConfig(
    code: IVsCode,
    workspaceFolder: vscode.Uri,
): Promise<vscode.Uri | undefined> {
    for await (const directory of walkDirectory(code, workspaceFolder)) {
        if (directory.uri.toString() === workspaceFolder.toString()) {
            continue;
        }

        if (directory.fileNames.has(StaticWebAppDatabaseConfigFileName)) {
            return directory.uri;
        }
    }

    return undefined;
}
