/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createTag, StandardTagNames } from '../../../utils/workspaceIndex/tags';
import type { WorkspaceDetector } from '../../../utils/workspaceIndex/WorkspaceDetector';

const containerApps = 'containerApps';

/** A Dockerfile, which is the build contract for a container app. */
export const DockerfileTag = createTag(containerApps, StandardTagNames.projectFile);

/**
 * Matches the file-name spellings Docker itself recognises: a bare
 * `Dockerfile`, a suffixed `Dockerfile.dev`, and a prefixed `api.Dockerfile`.
 */
function isDockerfile(name: string): boolean {
    const lower = name.toLowerCase();
    return lower === 'dockerfile'
        || lower.startsWith('dockerfile.')
        || lower.endsWith('.dockerfile');
}

/**
 * Tags every Dockerfile in the workspace.
 *
 * A container app's build contract is "there is a Dockerfile", so this is the
 * one signal the Container Apps product needs from the workspace. Indexing it
 * here keeps the product off the file system: no command walks the workspace
 * itself.
 */
export const containerAppsDetector: WorkspaceDetector = {
    id: 'containerApps',
    namespace: containerApps,
    inspect(node) {
        if (!node.isDirectory && isDockerfile(node.name)) {
            node.tag(DockerfileTag);
        }
    },
};
