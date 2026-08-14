/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMarkerFileDetector, type MarkerFileMetadata } from '../createMarkerFileDetector';
import type { WorkspaceDetector } from '../WorkspaceDetector';
import { defineWorkspaceTag, type WorkspaceTag } from '../WorkspaceTag';

/** Namespace owned by the Azure Functions detector. */
export const FunctionsNamespace = 'functions';

/**
 * A folder containing a Functions `host.json`, i.e. the root of an Azure
 * Functions project. The tag's metadata carries the `host.json` itself.
 */
export const FunctionsProjectTag: WorkspaceTag<MarkerFileMetadata> =
    defineWorkspaceTag<MarkerFileMetadata>(FunctionsNamespace, 'project');

/**
 * Detector for Azure Functions projects.
 *
 * `host.json` is the canonical marker for a Functions project regardless of
 * language, so a marker-file rule is sufficient. Determining the project's
 * language or its individual triggers requires reading further files and
 * belongs in an {@linkcode WorkspaceDetector.enrich} step.
 */
export function createFunctionsProjectDetector(): WorkspaceDetector {
    return createMarkerFileDetector(FunctionsNamespace, [
        { tag: FunctionsProjectTag, fileNames: ['host.json'] },
    ]);
}
