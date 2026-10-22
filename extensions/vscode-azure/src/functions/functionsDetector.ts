/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { WorkspaceDetector } from '../utils/workspaceIndex/WorkspaceDetector';
import { createTag, StandardTagNames } from '../utils/workspaceIndex/tags';

/** File name that marks an Azure Functions project. */
export const FunctionsHostFileName = 'host.json';

const functions = 'functions';

/** The `host.json` that marks an Azure Functions project. */
export const FunctionsHostFileTag = createTag(functions, StandardTagNames.projectFile);
/** Files that affect local function state or runtime selection. */
export const FunctionsSettingsFileTag = createTag(functions, 'settings');

/**
 * Tags the `host.json` of every Azure Functions project.
 *
 * Local settings files are tagged so edits invalidate the shared tree.
 */
export const functionsDetector: WorkspaceDetector = {
    id: 'functions',
    namespace: functions,
    inspect(node) {
        if (node.isDirectory) {
            return;
        }
        if (node.name === FunctionsHostFileName) {
            node.tag(FunctionsHostFileTag);
        } else if (node.name === 'local.settings.json') {
            node.tag(FunctionsSettingsFileTag);
        }
    },
};
