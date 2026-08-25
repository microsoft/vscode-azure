/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IVsCode } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';
import type { IWorkspaceIndexService } from '../utils/workspaceIndex/WorkspaceIndexService';
import type { WorkspaceDetector } from '../utils/workspaceIndex/WorkspaceDetector';
import { createTag, StandardTagNames } from '../utils/workspaceIndex/tags';

const staticWebApps = 'staticWebApps';

/** File name used for Static Web Apps database connections. */
export const StaticWebAppDatabaseConfigFileName = 'staticwebapp.database.config.json';

/** The `staticwebapp.database.config.json` that marks a data API folder. */
export const StaticWebAppDatabaseConfigTag = createTag(staticWebApps, StandardTagNames.projectFile);

/** Tags the database config of every Static Web Apps data API folder. */
export const staticWebAppDatabaseDetector: WorkspaceDetector = {
    id: 'staticWebAppsDatabase',
    namespace: staticWebApps,
    inspect(node) {
        if (!node.isDirectory && node.name === StaticWebAppDatabaseConfigFileName) {
            node.tag(StaticWebAppDatabaseConfigTag);
        }
    },
};

/**
 * Finds the folder holding `staticwebapp.database.config.json` beneath a root.
 *
 * The containing directory URI is returned because that is the value the SWA
 * CLI's `--data-api-location` expects.
 *
 * @remarks
 * Candidates arrive shallowest first, so the closest config wins when a project
 * has more than one -- which keeps a fixture or sample nested deep in the tree
 * from shadowing the project's own.
 *
 * The root itself is not a candidate: the CLI serves the app from the root and
 * the data API from a separate folder.
 */
export async function getFolderContainingDatabaseConfig(
    code: IVsCode,
    indexService: IWorkspaceIndexService,
    workspaceFolder: vscode.Uri,
): Promise<vscode.Uri | undefined> {
    const index = await indexService.getIndex();
    const root = workspaceFolder.toString().replace(/\/+$/, '');

    for (const configFile of index.withTag(StaticWebAppDatabaseConfigTag)) {
        const folder = code.Uri.joinPath(configFile, '..');
        const candidate = folder.toString().replace(/\/+$/, '');
        // The index spans every workspace folder, so a sibling folder's data
        // API must not be offered to this one.
        if (candidate !== root && candidate.startsWith(`${root}/`)) {
            return folder;
        }
    }

    return undefined;
}
