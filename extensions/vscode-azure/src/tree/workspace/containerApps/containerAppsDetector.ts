/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createTag, StandardTagNames } from '../../../utils/workspaceIndex/tags';
import type { WorkspaceDetector } from '../../../utils/workspaceIndex/WorkspaceDetector';

const containerApps = 'containerApps';

/** A Containerfile, which is the build contract for a container app. */
export const ContainerfileTag = createTag(containerApps, StandardTagNames.projectFile);

/**
 * Matches the file-name spellings a container build recognises: a bare
 * `Dockerfile`, a suffixed `Dockerfile.dev`, and a prefixed `api.Dockerfile`,
 * each also spelled `Containerfile`. Names are matched case-insensitively.
 */
const containerfilePattern = /^(?:.+\.)?(?:docker|container)file$|^(?:docker|container)file\./i;

function isContainerfile(name: string): boolean {
    return containerfilePattern.test(name);
}

/**
 * Tags every Containerfile in the workspace.
 *
 * A container app's build contract is "there is a Containerfile", so this is
 * the one signal the Container Apps product needs from the workspace. Indexing
 * it here keeps the product off the file system: no command walks the
 * workspace itself.
 */
export const containerAppsDetector: WorkspaceDetector = {
    id: 'containerApps',
    namespace: containerApps,
    inspect(node) {
        if (!node.isDirectory && isContainerfile(node.name)) {
            node.tag(ContainerfileTag);
        }
    },
};
