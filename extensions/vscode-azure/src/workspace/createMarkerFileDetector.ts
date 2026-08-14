/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { dirname } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';
import type { WorkspaceCandidate, WorkspaceDetector, WorkspaceTagging } from './WorkspaceDetector';
import { applyTag, type WorkspaceTag } from './WorkspaceTag';

/**
 * Metadata attached by every {@linkcode createMarkerFileDetector} rule: the file
 * whose presence identified the project.
 *
 * Detection tags the *containing folder*, because that is what consumers
 * actually want ("where does this project live"); the marker file remains
 * reachable here for callers that need to read or open it.
 */
export interface MarkerFileMetadata {
    /** The marker file that matched, e.g. the `package.json` or `azure.yaml`. */
    readonly manifestUri: vscode.Uri;
}

/** One "these files mean this tag" rule. */
export interface MarkerFileRule {
    /** Tag to apply to the folder containing a matched file. */
    readonly tag: WorkspaceTag<MarkerFileMetadata>;
    /** Exact file names that trigger the tag, e.g. `host.json`. Case-sensitive. */
    readonly fileNames?: readonly string[];
    /** File name suffixes that trigger the tag, e.g. `.csproj`. Case-sensitive. */
    readonly suffixes?: readonly string[];
}

/**
 * Build a {@linkcode WorkspaceDetector} from a declarative table of marker-file
 * rules, for the common case where a project type is identified purely by the
 * presence of a file.
 *
 * Rules are declarative so that adding a project type is a table entry rather
 * than a new detection code path. Detectors that need real logic (parsing a
 * manifest, probing a CLI) should implement {@linkcode WorkspaceDetector}
 * directly, or use this for discovery and add an `enrich` step.
 *
 * @param namespace - Namespace owning every tag in {@linkcode rules}.
 * @param rules - The rule table.
 *
 * @throws If any rule's tag is outside {@linkcode namespace}, which would be
 *   silently dropped at scan time.
 *
 * @example
 * ```ts
 * export const AzdProjectTag = defineWorkspaceTag<MarkerFileMetadata>('azd', 'project');
 *
 * const detector = createMarkerFileDetector('azd', [
 *     { tag: AzdProjectTag, fileNames: ['azure.yaml', 'azure.yml'] },
 * ]);
 * ```
 */
export function createMarkerFileDetector(namespace: string, rules: readonly MarkerFileRule[]): WorkspaceDetector {
    for (const rule of rules) {
        if (rule.tag.namespace !== namespace) {
            throw new Error(`Marker file rule for tag '${rule.tag.name}' does not belong to namespace '${namespace}'.`);
        }
    }

    return {
        namespace,
        visit: (candidate: WorkspaceCandidate): WorkspaceTagging[] | undefined => {
            if (candidate.isDirectory) {
                return undefined;
            }

            let taggings: WorkspaceTagging[] | undefined;
            for (const rule of rules) {
                if (matches(rule, candidate.name)) {
                    taggings ??= [];
                    taggings.push({
                        uri: dirname(candidate.uri),
                        isDirectory: true,
                        tags: [applyTag(rule.tag, { manifestUri: candidate.uri })],
                    });
                }
            }
            return taggings;
        },
    };
}

function matches(rule: MarkerFileRule, name: string): boolean {
    return (rule.fileNames?.includes(name) ?? false)
        || (rule.suffixes?.some(suffix => name.endsWith(suffix)) ?? false);
}
