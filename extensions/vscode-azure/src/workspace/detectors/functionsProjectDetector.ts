/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { dirname } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';
import type { WorkspaceDetector } from '../WorkspaceDetector';
import { applyTag, defineWorkspaceTag, ProjectTagName, type WorkspaceTag } from '../WorkspaceTag';

/** Namespace owned by the Azure Functions detector. */
export const FunctionsNamespace = 'functions';

/** File that identifies a Functions project root, regardless of language. */
export const HostJsonFileName = 'host.json';

/** Metadata carried by {@linkcode FunctionsProjectTag}. */
export interface FunctionsProjectMetadata {
    /** The `host.json` that identified the project. */
    readonly manifestUri: vscode.Uri;
}

/**
 * A folder containing a Functions `host.json`, i.e. the root of an Azure
 * Functions project. The tag's metadata carries the `host.json` itself.
 */
export const FunctionsProjectTag: WorkspaceTag<FunctionsProjectMetadata> =
    defineWorkspaceTag<FunctionsProjectMetadata>(FunctionsNamespace, ProjectTagName);

/**
 * Detector for Azure Functions projects.
 *
 * `host.json` is the canonical marker for a Functions project regardless of
 * language, so a name check is sufficient. Determining the project's language
 * or its individual triggers requires reading further files and belongs in a
 * {@linkcode WorkspaceDetector.enrich} step.
 */
export function createFunctionsProjectDetector(): WorkspaceDetector {
    return {
        namespace: FunctionsNamespace,
        visit: candidate => {
            if (candidate.isDirectory || candidate.name !== HostJsonFileName) {
                return undefined;
            }
            // Tag the containing folder -- "where does this project live" is
            // what consumers want; the manifest stays reachable as metadata.
            return [{
                uri: dirname(candidate.uri),
                isDirectory: true,
                tags: [applyTag(FunctionsProjectTag, { manifestUri: candidate.uri })],
            }];
        },
    };
}
