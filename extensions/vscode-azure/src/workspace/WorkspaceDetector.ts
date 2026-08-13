/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IVsCode } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';
import type { WorkspaceEntry } from './WorkspaceEntry';
import type { AppliedTag } from './WorkspaceTag';

/**
 * One location a detector wants tagged.
 *
 * Several detectors may return taggings for the same {@linkcode uri}; the scan
 * merges them into a single {@linkcode WorkspaceEntry} carrying the union of
 * their tags.
 */
export interface WorkspaceTagging {
    /** The file or folder to tag. Must lie within the folder being scanned. */
    readonly uri: vscode.Uri;
    /**
     * Whether {@linkcode uri} is a directory. Defaults to `false`.
     *
     * Detectors know this from how they found the location, so it is declared
     * rather than `stat`ed. When two detectors disagree, the first tagging for
     * the URI wins.
     */
    readonly isDirectory?: boolean;
    /** Tags to attach, built with {@linkcode applyTag}. */
    readonly tags: readonly AppliedTag[];
}

/**
 * Services handed to a detector for one scan of one workspace folder.
 *
 * Detectors are deliberately unconstrained in *how* they detect -- reading files
 * through {@linkcode IVsCode.workspace}, shelling out, parsing manifests -- but
 * anything glob-shaped should go through {@linkcode findFiles}, which applies
 * the shared exclusions and coalesces repeated globs.
 */
export interface WorkspaceScanContext {
    /** The VS Code API, for reading files and any other detection work. */
    readonly code: IVsCode;
    /** The workspace folder being scanned. */
    readonly folder: vscode.WorkspaceFolder;

    /**
     * Find files matching {@linkcode pattern} within
     * {@linkcode WorkspaceScanContext.folder folder}.
     *
     * Scopes the search to the folder, applies
     * {@linkcode DefaultScanExcludeGlob} and
     * {@linkcode DefaultScanMaxResults}, and caches results per pattern for the
     * duration of the scan -- so several detectors asking for the same glob
     * cost one search.
     *
     * @param pattern - A glob relative to the folder root, e.g. `**\/host.json`.
     */
    findFiles(pattern: string): Promise<readonly vscode.Uri[]>;
}

/**
 * Contributes tags to the workspace index.
 *
 * A detector is asked to {@linkcode detect} once per workspace folder per scan,
 * and its results are merged with every other detector's. Detection should be
 * cheap: it runs on activation, on workspace changes, and inside interactive
 * wizard steps. Push anything expensive (spawning a process, parsing large
 * files) into {@linkcode enrich}, which runs in the background after the index
 * is already queryable.
 *
 * A detector that throws is logged and skipped for that folder; the rest of the
 * index still loads.
 */
export interface WorkspaceDetector {
    /**
     * Namespace this detector owns, e.g. `azd`.
     *
     * Every tag the detector applies must be defined in this namespace --
     * applications of tags from another namespace are dropped with a warning, so
     * that the owner of a tag is always the detector that can be asked to
     * refresh it.
     */
    readonly namespace: string;

    /**
     * Globs whose changes should invalidate this detector's results, relative to
     * a workspace folder (e.g. `**\/host.json`).
     *
     * The service creates one watcher per distinct pattern across all detectors.
     * Plain-string globs are filtered off VS Code's existing recursive workspace
     * watcher rather than creating an OS-level watcher, so declaring several is
     * effectively free.
     *
     * Omit only when the detector's results cannot be tied to file changes; it
     * then relies on the index TTL and explicit refreshes, since watching
     * everything would rescan the world on any edit.
     */
    readonly watchPatterns?: readonly string[];

    /**
     * Find the locations this detector wants tagged within one workspace folder.
     *
     * Called for every folder on every scan. Return an empty array when nothing
     * matches.
     */
    detect(context: WorkspaceScanContext): Promise<readonly WorkspaceTagging[]>;

    /**
     * Optionally add late-arriving tags or metadata to an entry this detector
     * contributed to.
     *
     * Runs in the background once the entry is in the index, so the index is
     * usable before enrichment finishes; callers that need the result await
     * {@linkcode IWorkspaceDataService.whenEnriched}. This is where expensive
     * detection belongs -- e.g. shelling out to a CLI to read a project's
     * configured environment.
     *
     * Implementations must mutate {@linkcode entry} in place (typically by
     * pushing onto {@linkcode WorkspaceEntry.tags}) so references held by
     * callers stay valid.
     */
    enrich?(entry: WorkspaceEntry, context: WorkspaceScanContext): Promise<void>;
}
