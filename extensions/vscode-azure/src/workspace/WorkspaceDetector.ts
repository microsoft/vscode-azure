/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IVsCode } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';
import type { WorkspaceEntry } from './WorkspaceEntry';
import type { AppliedTag } from './WorkspaceTag';

/**
 * One file or folder the scan walked past, offered to every detector.
 *
 * {@linkcode name} is provided so the overwhelmingly common check -- "is this
 * file called `host.json`" -- is a string comparison rather than URI parsing.
 */
export interface WorkspaceCandidate {
    /** The file or folder. */
    readonly uri: vscode.Uri;
    /** Final path segment of {@linkcode uri}, e.g. `host.json`. */
    readonly name: string;
    /** Whether {@linkcode uri} is a directory. */
    readonly isDirectory: boolean;
    /** The workspace folder being scanned. */
    readonly folder: vscode.WorkspaceFolder;
}

/**
 * One location a detector wants tagged.
 *
 * The tagged {@linkcode uri} need not be the candidate that triggered it -- a
 * marker file usually tags the folder containing it. Several detectors may
 * return taggings for the same URI; the scan merges them into a single
 * {@linkcode WorkspaceEntry} carrying the union of their tags.
 */
export interface WorkspaceTagging {
    /** The file or folder to tag. */
    readonly uri: vscode.Uri;
    /**
     * Whether {@linkcode uri} is a directory. Defaults to `false`.
     *
     * Declared rather than `stat`ed, since the detector already knows. When two
     * detectors disagree, the first tagging for the URI wins.
     */
    readonly isDirectory?: boolean;
    /** Tags to attach, built with {@linkcode applyTag}. */
    readonly tags: readonly AppliedTag[];
}

/**
 * Contributes tags to the workspace index.
 *
 * The index performs a single breadth-first walk of each workspace folder and
 * offers every file and folder it sees to every detector, so a detector never
 * runs its own search and adding one costs no extra I/O.
 *
 * A detector that throws is logged at warning level and skipped for the rest of
 * that folder's scan; the rest of the index still loads.
 */
export interface WorkspaceDetector {
    /**
     * Namespace this detector owns, e.g. `azd`.
     *
     * Every tag the detector applies must be defined in this namespace --
     * applications of tags from another namespace are dropped and logged at
     * warning level, so that the owner of a tag is always the detector that can
     * be asked to refresh it.
     */
    readonly namespace: string;

    /**
     * Decide whether {@linkcode candidate} is interesting, and if so what to
     * tag.
     *
     * Called for every file and folder in the workspace, so it must be cheap --
     * a name check, not I/O. It is deliberately synchronous to enforce that.
     * Anything requiring file contents, a subprocess, or a network call belongs
     * in {@linkcode enrich}.
     *
     * The same method also decides whether a file-change event is worth a
     * rescan, so a detector that recognizes a name here automatically gets
     * refreshed when a file of that name appears or disappears.
     *
     * @returns Taggings to record, or `undefined`/an empty array to ignore the
     *   candidate.
     */
    visit(candidate: WorkspaceCandidate): readonly WorkspaceTagging[] | undefined;

    /**
     * Optionally add late-arriving tags or metadata to an entry this detector
     * contributed to.
     *
     * Runs in the background once the entry is in the index, so the index is
     * usable before enrichment finishes; callers that need the result await
     * {@linkcode IWorkspaceDataService.whenEnriched}. This is where expensive
     * detection belongs -- e.g. reading a manifest, or shelling out to a CLI to
     * read a project's configured environment.
     *
     * Implementations must mutate {@linkcode entry} in place (typically by
     * pushing onto {@linkcode WorkspaceEntry.tags}) so references held by
     * callers stay valid.
     */
    enrich?(entry: WorkspaceEntry, code: IVsCode): Promise<void>;
}
