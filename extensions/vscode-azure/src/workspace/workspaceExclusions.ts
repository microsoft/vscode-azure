/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Directories never worth scanning: dependency caches, build output, and VCS
 * metadata. Marker files inside these are almost always vendored copies of
 * someone else's project rather than the user's own.
 *
 * This exists because stable
 * {@linkcode vscode.workspace.findFiles findFiles} cannot honor `.gitignore` --
 * it hard-codes `useIgnoreFiles: { local: false }` internally -- and it drops
 * the user's `files.exclude` as soon as an explicit `exclude` argument is
 * passed. A curated list is therefore the only exclusion mechanism available.
 *
 * When `findFiles2` (which accepts `useIgnoreFiles`) leaves proposed API and
 * lands in our `@types/vscode` baseline, this constant and
 * {@linkcode DefaultScanMaxResults} should be replaced by real ignore-file
 * handling. Keeping both here means that swap touches one file.
 */
export const ExcludedScanDirectories: readonly string[] = [
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
];

/**
 * Glob passed as the `exclude` argument of every index scan, built from
 * {@linkcode ExcludedScanDirectories}.
 *
 * Matches the excluded directories at any depth, so a marker file nested
 * anywhere beneath one is skipped.
 */
export const DefaultScanExcludeGlob = `**/{${ExcludedScanDirectories.join(',')}}/**`;

/**
 * Cap on results per glob per workspace folder during a scan.
 *
 * Scans run inside interactive wizard steps and tree refreshes, so an
 * unbounded walk of a monorepo is not acceptable. The bound is generous enough
 * that a realistic repository is fully indexed, and acts purely as a safety
 * valve on pathological trees.
 */
export const DefaultScanMaxResults = 512;
