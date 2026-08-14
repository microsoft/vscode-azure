/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';

/**
 * Directories the scan never descends into: dependency caches, build output,
 * and VCS metadata. Marker files inside these are almost always vendored copies
 * of someone else's project rather than the user's own.
 *
 * A curated list rather than `.gitignore`: honoring ignore files needs
 * `findFiles2`, which is still proposed API and absent from our
 * `@types/vscode` baseline. Keeping the list here means that swap touches one
 * file.
 */
export const ExcludedScanDirectories: ReadonlySet<string> = new Set([
    '.git',
    '.hg',
    '.svn',
    '.venv',
    '.tox',
    '.next',
    '.nuxt',
    '.gradle',
    '.terraform',
    'node_modules',
    'bower_components',
    'vendor',
    'bin',
    'obj',
    'dist',
    'out',
    'build',
    'target',
    'venv',
    '__pycache__',
]);

/**
 * Cap on files and folders visited per workspace folder per scan.
 *
 * Scans run inside interactive wizard steps and tree refreshes, so an unbounded
 * walk of a pathological tree is not acceptable. Generous enough that a
 * realistic repository is fully indexed.
 */
export const MaxScanEntries = 20_000;

/**
 * Whether {@linkcode uri} lies inside one of
 * {@linkcode ExcludedScanDirectories}.
 *
 * Used to drop file-change events from directories the scan would not have
 * walked (an `npm install` churning `node_modules` must not trigger rescans).
 */
export function isExcludedPath(uri: vscode.Uri): boolean {
    return uri.path.split('/').some(segment => ExcludedScanDirectories.has(segment));
}
