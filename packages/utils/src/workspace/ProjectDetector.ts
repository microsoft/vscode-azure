/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';

/**
 * One candidate project directory, presented to a {@linkcode ProjectDetector}.
 *
 * All lookups are scoped to files directly inside this directory -- detection is
 * directory-local by design, which is what lets the walk evaluate each directory
 * once, as it is enumerated, without retaining a whole-workspace file index.
 *
 * Reads are memoized per directory, so several detectors inspecting the same
 * manifest cost one read.
 */
export interface ProjectDirectory {
    readonly uri: vscode.Uri;
    /** POSIX-style path relative to the workspace folder, or `.` for its root. */
    readonly relativePath: string;

    /** Whether a file with exactly this name sits in this directory. */
    has(name: string): boolean;

    /** The first file name in this directory ending with `suffix`, if any. */
    findBySuffix(suffix: string): string | undefined;

    /**
     * Parsed JSON contents of `name`, or `undefined` when the file is absent,
     * too large, or malformed. Malformed manifests are treated as absent so a
     * broken file cannot abort the scan.
     */
    json(name: string): Promise<unknown>;

    /** Raw text of `name`, or `undefined` when absent or too large. */
    text(name: string): Promise<string | undefined>;

    /** Whether `package.json` lists `name` under `dependencies` or `devDependencies`. */
    hasDependency(name: string): Promise<boolean>;
}

/** Characteristics a detector attributes to a project directory. */
export interface ProjectDetection {
    readonly frameworks?: readonly string[];
    readonly buildTools?: readonly string[];
    readonly languages?: readonly string[];
    /** Relative build output path. Ignored if absolute or parent-traversing. */
    readonly outputDirectory?: string;
}

/**
 * Classifies a candidate directory, returning `undefined` when it does not apply.
 *
 * Detectors are plain functions rather than declarative rules: mutual exclusions
 * (Next.js over React, SvelteKit over Svelte) read as ordinary conditions instead
 * of needing priority ordering or a predicate interpreter.
 *
 * Results from all matching detectors are merged, so a detector should describe
 * one concern and stay silent otherwise.
 */
export type ProjectDetector = (directory: ProjectDirectory) => Promise<ProjectDetection | undefined> | ProjectDetection | undefined;

/**
 * File names and suffixes that make a directory a project candidate.
 *
 * Matched with a {@linkcode Set} lookup and a short suffix list rather than glob
 * matching: this runs for every file in the workspace, and `matchesGlob`
 * recompiles its pattern on each call, which dominated the scan when profiled.
 */
export interface ProjectMarkers {
    readonly names: ReadonlySet<string>;
    readonly suffixes: readonly string[];
}

/** Whether `fileName` marks its directory as a project candidate. */
export function isProjectMarker(fileName: string, markers: ProjectMarkers): boolean {
    return markers.names.has(fileName)
        || markers.suffixes.some(suffix => fileName.endsWith(suffix));
}
