/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { WorkspaceDetector } from '../../../utils/workspaceIndex/WorkspaceDetector';
import { StandardTagNames, tagNamespace } from '../../../utils/workspaceIndex/WorkspaceTag';

/** File name that marks an Azure Functions project. */
export const FunctionsHostFileName = 'host.json';

const functions = tagNamespace('functions');

/** A directory containing a Functions `host.json`. */
export const FunctionsProject = functions.tag(StandardTagNames.projectRoot);

/** The `host.json` file itself. */
export const FunctionsHostFile = functions.tag(StandardTagNames.projectFile);

/**
 * Tags Azure Functions projects and their `host.json`.
 *
 * Listing the individual functions inside a project is tracked by
 * https://github.com/microsoft/vscode-azure/issues/178; it fits here as a
 * further tag applied to the project's source files.
 */
export const functionsDetector: WorkspaceDetector = {
    id: 'functions',
    namespace: functions,
    directories: true,
    files: { names: [FunctionsHostFileName] },
    inspect(node) {
        if (node.isDirectory) {
            if (node.fileNames.has(FunctionsHostFileName)) {
                node.tag(FunctionsProject);
            }
        } else {
            node.tag(FunctionsHostFile);
        }
    },
};
