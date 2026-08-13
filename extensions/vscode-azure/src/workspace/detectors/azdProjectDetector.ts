/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMarkerFileDetector, type MarkerFileMetadata } from '../createMarkerFileDetector';
import type { WorkspaceDetector } from '../WorkspaceDetector';
import { defineWorkspaceTag, type WorkspaceTag } from '../WorkspaceTag';

/** Namespace owned by the azd detector. */
export const AzdNamespace = 'azd';

/**
 * A folder containing an `azure.yaml` / `azure.yml`, i.e. the root of an azd
 * project. The tag's metadata carries the manifest file itself.
 *
 * Consumers should prefer this over searching for `azure.yaml` themselves, so
 * that project discovery is scanned once and shared.
 */
export const AzdProjectTag: WorkspaceTag<MarkerFileMetadata> =
    defineWorkspaceTag<MarkerFileMetadata>(AzdNamespace, 'project');

/**
 * Detector for azd projects.
 *
 * Discovery is purely marker-file based. Anything requiring `azd` itself (the
 * project's display name, its configured environment or resource group) is
 * deliberately not done here: shelling out to a CLI during discovery would make
 * every workspace query wait on a process. Such work belongs in an
 * {@linkcode WorkspaceDetector.enrich} step, which is where detecting an azd
 * project by environment name / resource group would be added.
 */
export function createAzdProjectDetector(): WorkspaceDetector {
    return createMarkerFileDetector(AzdNamespace, [
        { tag: AzdProjectTag, patterns: ['**/azure.yaml', '**/azure.yml'] },
    ]);
}
