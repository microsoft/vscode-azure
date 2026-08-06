/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IVsCode } from '@microsoft/vscode-azure-utils';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import { parse } from 'yaml';
import type { IAzdService } from '../../azd/AzdService';

/** Canonical GitHub Actions workflow paths `azd pipeline config` scaffolds/expects. */
export const githubWorkflowPaths = ['.github/workflows/azure-dev.yml', '.github/workflows/azure-dev.yaml'];
/** Canonical Azure Pipelines workflow paths `azd pipeline config` scaffolds/expects. */
export const azdoWorkflowPaths = [
    '.azdo/pipelines/azure-dev.yml',
    '.azdo/pipelines/azure-dev.yaml',
    '.azuredevops/pipelines/azure-dev.yml',
    '.azuredevops/pipelines/azure-dev.yaml',
];

/**
 * Overall auto-deploy eligibility for a Static Web Apps project, covering
 * both routing decision points (creation and the standalone command).
 * `'supported'` means both direct deploy and CI/CD are viable candidates
 * (the actual choice between them is then made from the Git remote).
 */
export type StaticWebAppAutoDeployEligibility = 'supported' | StaticWebAppUnsupportedArtifactReason;

/**
 * Reason automatic deployment (direct or CI/CD) is not possible, used to show
 * accurate, reason-specific guidance instead of one generic message --
 * critically, a malformed/missing service configuration must never be
 * reported with Next.js-specific wording, and vice versa.
 */
export type StaticWebAppUnsupportedArtifactReason =
    /** Next.js hybrid/SSR: server-rendered content, unrelated to configuration validity. */
    | 'hybridSsr'
    /** No `host: staticwebapp` service found, or one with a missing/non-string/empty/`.`/`/` `dist`. */
    | 'invalidServiceConfig';

/**
 * Checks whether the *other* CI/CD provider's canonical workflow file already
 * exists in {@linkcode iacFolder}, so callers can require explicit
 * confirmation before configuring a second, different provider rather than
 * silently enabling two active pipelines. Never deletes or overwrites either
 * file -- `azd pipeline config` owns that.
 */
export async function hasConflictingProviderWorkflow(
    code: IVsCode,
    iacFolder: vscode.Uri,
    provider: 'github' | 'azdo',
): Promise<boolean> {
    const otherProviderPaths = provider === 'github' ? azdoWorkflowPaths : githubWorkflowPaths;
    for (const relativePath of otherProviderPaths) {
        try {
            await code.workspace.fs.stat(code.Uri.joinPath(iacFolder, relativePath));
            return true;
        } catch {
            // Not found -- check the next candidate path.
        }
    }
    return false;
}

/** Parsed `host: staticwebapp` service fields relevant to deployment eligibility. */
export interface StaticWebAppServiceConfig {
    /** The service's `dist`, or `undefined` when missing/non-string. Note an explicit empty string is a distinct, still-invalid value. */
    readonly dist?: string;
    /** The service's raw `project` value as written in `azure.yaml`, or `undefined` when missing/non-string. Not yet validated/resolved -- see {@linkcode resolveStaticWebAppServiceProjectFolder}. */
    readonly project?: string;
}

/**
 * Reads `azure.yaml` in {@linkcode iacFolder} directly and returns its
 * `host: staticwebapp` service's `dist`/`project` fields, or `undefined` when
 * **no such service is configured at all** (or `azure.yaml`/the service can't
 * be read/parsed). This return-value distinction -- `undefined` (no service)
 * vs. an object with an empty/invalid `dist`/`project` (service present but
 * misconfigured) -- matters to callers and to tests: both are ultimately
 * "unsupported", but for different, distinguishable reasons.
 *
 * Used both to detect an existing `host: staticwebapp` service (standalone
 * command project resolution) and to derive direct-deploy/CI eligibility for
 * an already-hydrated project whose `outputLocation` was never captured by
 * the current wizard run (`OutputLocationStep` skips prompting once
 * `infra/main.bicep` already exists).
 */
export async function getStaticWebAppServiceConfig(
    azd: IAzdService,
    code: IVsCode,
    iacFolder: vscode.Uri,
): Promise<StaticWebAppServiceConfig | undefined> {
    const yamlFiles = await azd.findAzureYaml(iacFolder);
    if (yamlFiles.length === 0) {
        return undefined;
    }
    let source: string;
    try {
        source = new TextDecoder().decode(await code.workspace.fs.readFile(yamlFiles[0]));
    } catch {
        return undefined;
    }
    let parsed: unknown;
    try {
        parsed = parse(source);
    } catch {
        return undefined;
    }
    if (!isRecord(parsed) || !isRecord(parsed.services)) {
        return undefined;
    }
    for (const service of Object.values(parsed.services)) {
        if (isRecord(service) && typeof service.host === 'string' && service.host.toLowerCase() === 'staticwebapp') {
            return {
                dist: typeof service.dist === 'string' ? service.dist : undefined,
                project: typeof service.project === 'string' ? service.project : undefined,
            };
        }
    }
    return undefined;
}

/**
 * Reports whether `value` is absolute according to Go's `filepath.IsAbs` on
 * Windows -- which is *not* the same as Node's `path.win32.isAbsolute` for
 * one specific case. Both agree that a drive-absolute path (`C:\foo`) and a
 * UNC/device-absolute path (`\\server\share`, `\\.\C:\foo`) are absolute, and
 * that a drive-relative path (`C:foo`, a drive letter with no separator
 * after the colon) is not. They diverge only for a path rooted with a
 * *single* leading separator and no volume at all (`/foo` or `\foo`): Node
 * treats it as absolute (rooted on whatever the current drive happens to
 * be), but Go requires an actual volume (a drive letter or a UNC/device
 * prefix) before a path counts as rooted, so azd would join such a value
 * against the project root instead of treating it as an OS-root-absolute
 * path independent of it.
 */
function isWindowsAbsoluteGoStyle(value: string): boolean {
    if (!path.win32.isAbsolute(value)) {
        return false;
    }
    const isWindowsSeparator = (ch: string | undefined) => ch === '\\' || ch === '/';
    const hasDriveLetter = /^[A-Za-z]:/.test(value);
    const hasUncOrDevicePrefix = isWindowsSeparator(value[0]) && isWindowsSeparator(value[1]);
    return hasDriveLetter || hasUncOrDevicePrefix;
}

/**
 * Resolves a `project` value against `iacFolderFsPath` using Windows path
 * semantics that mirror Go's `filepath.IsAbs` + `filepath.Join` exactly (see
 * {@linkcode isWindowsAbsoluteGoStyle}), rather than Node's own
 * `path.win32.resolve`, which would incorrectly treat a `/foo`-style
 * singly-rooted value as an OS-root-absolute path independent of
 * `iacFolderFsPath`.
 *
 * A value Go considers absolute is used **unchanged** (only lexically
 * normalized via `path.win32.resolve` with no base, since it's already
 * rooted and never needs one). A value Go considers relative -- including
 * `/foo`, `C:foo`, and ordinary relative/`..` paths -- is resolved with
 * `path.win32.join`, **not** `path.win32.resolve`: `join` concatenates and
 * lexically cleans without ever re-rooting on a later absolute-looking
 * segment (matching Go's `filepath.Join`, verified to produce identical
 * output for these exact cases), whereas `resolve` would restart from a
 * later segment Node itself considers absolute.
 *
 * Factored out as a pure, synchronous, string-only function (no
 * `vscode`/`fs` dependency) so its Windows-specific logic can be unit-tested
 * on any host via `path.win32` directly, without needing an actual Windows
 * machine or `process.platform` to agree.
 */
export function resolveWindowsProjectPath(iacFolderFsPath: string, project: string): string {
    return isWindowsAbsoluteGoStyle(project) ? path.win32.resolve(project) : path.win32.join(iacFolderFsPath, project);
}

/**
 * Resolves a `project` value against `iacFolderFsPath` using POSIX path
 * semantics. Unlike Windows, Node's `path.posix.isAbsolute` (a path starting
 * with `/`) already matches Go's `filepath.IsAbs` on POSIX exactly, so no
 * corrective classifier is needed here -- `path.posix.resolve` is used
 * directly for both branches.
 *
 * Factored out alongside {@linkcode resolveWindowsProjectPath} as a pure,
 * synchronous, string-only function so both can be unit-tested independent
 * of the host's actual platform.
 */
export function resolvePosixProjectPath(iacFolderFsPath: string, project: string): string {
    return path.posix.isAbsolute(project) ? path.posix.resolve(project) : path.posix.resolve(iacFolderFsPath, project);
}

/**
 * Resolves a `host: staticwebapp` service's raw `project` value (as returned
 * by {@linkcode getStaticWebAppServiceConfig}) to an actual, existing
 * directory URI, mirroring azd's own `ServiceConfig.Path()` semantics for
 * **the current host platform** -- azd is a Go binary running on the same
 * machine as this extension, and Go's `path/filepath` package itself
 * branches on the host OS (backslash is a literal character on POSIX, and
 * `filepath.IsAbs`/`filepath.Join` have Windows-specific rules -- see
 * {@linkcode resolveWindowsProjectPath}/{@linkcode resolvePosixProjectPath}),
 * so this must too, rather than normalizing both POSIX and Windows
 * separator/absolute-path forms simultaneously regardless of host.
 *
 * This is pure string/path-API use (no Node `fs` I/O) up to this point --
 * the resulting host-native filesystem path is converted back to a
 * {@linkcode vscode.Uri} via `code.Uri.file` before the one and only I/O
 * call, {@linkcode vscode.FileSystem.stat workspace.fs.stat}, which is what
 * actually verifies existence/directory-ness.
 *
 * Returns `undefined` -- meaning `'invalidServiceConfig'`, never a silent
 * fallback to scanning {@linkcode iacFolder} itself -- for any of:
 * - a missing/empty `project` (required; never assumed to default to the
 *   IaC folder -- azd itself requires a `project` on every service),
 * - a path that doesn't exist, or that exists but isn't a directory (e.g. it
 *   names a file).
 *
 * Callers must not run framework detection or grant eligibility before this
 * check succeeds.
 */
export async function resolveStaticWebAppServiceProjectFolder(
    code: IVsCode,
    iacFolder: vscode.Uri,
    project: string | undefined,
): Promise<vscode.Uri | undefined> {
    if (!project) {
        return undefined;
    }

    const resolvedPath = process.platform === 'win32'
        ? resolveWindowsProjectPath(iacFolder.fsPath, project)
        : resolvePosixProjectPath(iacFolder.fsPath, project);
    const projectFolder = code.Uri.file(resolvedPath);

    try {
        const stat = await code.workspace.fs.stat(projectFolder);
        return (stat.type & code.FileType.Directory) !== 0 ? projectFolder : undefined;
    } catch {
        return undefined;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
