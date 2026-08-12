/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { WorkspaceDetector } from '../../../utils/workspaceIndex/WorkspaceDetector';
import { StandardTagNames, tagNamespace } from '../../../utils/workspaceIndex/WorkspaceTag';

/** File names that mark an azd project. */
export const AzureYamlFileNames = ['azure.yaml', 'azure.yml'];

const azd = tagNamespace('azd');

/** A directory containing an `azure.yaml` / `azure.yml`. */
export const AzdProject = azd.tag(StandardTagNames.projectRoot);

/** The `azure.yaml` / `azure.yml` file itself. */
export const AzdProjectFile = azd.tag(StandardTagNames.projectFile);

/** Tags azd projects and their `azure.yaml`. */
export const azdDetector: WorkspaceDetector = {
    id: 'azd',
    namespace: azd,
    directories: true,
    files: { names: AzureYamlFileNames },
    inspect(node) {
        if (node.isDirectory) {
            if (AzureYamlFileNames.some(name => node.fileNames.has(name))) {
                node.tag(AzdProject);
            }
        } else {
            node.tag(AzdProjectFile);
        }
    },
};
