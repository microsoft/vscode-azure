/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { dirname } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';
import { AzureYamlFileNames } from '../../azd/AzdService';
import type { WorkspaceDetector } from '../WorkspaceDetector';
import { applyTag, defineWorkspaceTag, ProjectTagName, type WorkspaceTag } from '../WorkspaceTag';

/** Namespace owned by the azd detector. */
export const AzdNamespace = 'azd';

/** Metadata carried by {@linkcode AzdProjectTag}. */
export interface AzdProjectMetadata {
    /** The `azure.yaml` / `azure.yml` that identified the project. */
    readonly manifestUri: vscode.Uri;
}

/**
 * A folder containing an `azure.yaml` / `azure.yml`, i.e. the root of an azd
 * project. The tag's metadata carries the manifest file itself.
 *
 * Consumers should prefer this over searching for `azure.yaml` themselves, so
 * that project discovery is scanned once and shared.
 */
export const AzdProjectTag: WorkspaceTag<AzdProjectMetadata> =
    defineWorkspaceTag<AzdProjectMetadata>(AzdNamespace, ProjectTagName);

/**
 * Detector for azd projects.
 *
 * Detection is purely by file name, reusing {@linkcode AzureYamlFileNames} so
 * the extension has one answer to "what is an azd manifest called". Anything
 * requiring `azd` itself (the project's display name, its configured
 * environment or resource group) is deliberately not done here: shelling out to
 * a CLI during a workspace walk would make every query wait on a process. Such
 * work belongs in a {@linkcode WorkspaceDetector.enrich} step, which is where
 * detecting an azd project by environment name / resource group would be added.
 */
export function createAzdProjectDetector(): WorkspaceDetector {
    return {
        namespace: AzdNamespace,
        visit: candidate => {
            if (candidate.isDirectory || !AzureYamlFileNames.includes(candidate.name)) {
                return undefined;
            }
            // Tag the containing folder -- "where does this project live" is
            // what consumers want; the manifest stays reachable as metadata.
            return [{
                uri: dirname(candidate.uri),
                isDirectory: true,
                tags: [applyTag(AzdProjectTag, { manifestUri: candidate.uri })],
            }];
        },
    };
}
