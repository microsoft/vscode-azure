/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { WorkspaceDetector } from '../utils/workspaceIndex/WorkspaceDetector';
import { createTag, StandardTagNames } from '../utils/workspaceIndex/tags';
import { AzureYamlFileNames } from './AzdService';

const AzdDetectorId = 'azd';
const AzdTagNamespace = 'azd';

/** The `azure.yaml` / `azure.yml` file that marks an azd project. */
export const AzdProjectFileTag = createTag(AzdTagNamespace, StandardTagNames.projectFile);

/** Tags the project file of every azd project in the shared workspace index. */
export const azdDetector: WorkspaceDetector = {
    id: AzdDetectorId,
    namespace: AzdTagNamespace,
    inspect(node) {
        if (!node.isDirectory && AzureYamlFileNames.includes(node.name)) {
            node.tag(AzdProjectFileTag);
        }
    },
};
