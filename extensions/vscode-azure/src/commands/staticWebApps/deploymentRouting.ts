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
 * Resolves a `host: staticwebapp` service's raw `project` value (as returned
 * by {@linkcode getStaticWebAppServiceConfig}) to an actual, existing
 * directory URI, mirroring azd's own `ServiceConfig.Path()` semantics for
 * **the current host platform** -- azd is a Go binary running on the same
 * machine as this extension, and Go's `path/filepath` package itself
 * branches on the host OS (backslash is a literal character on POSIX, and
 * `filepath.IsAbs`/`filepath.Join` differ on Windows), so this must too,
 * rather than normalizing both POSIX and Windows separator/absolute-path
 * forms simultaneously regardless of host. `node:path`'s default export
 * (`path.isAbsolute`/`path.resolve`) already resolves to the host-native
 * `path.win32`/`path.posix` implementation at runtime, so it's used directly
 * instead of hand-rolled cross-platform parsing:
 * - An absolute `project` (per host semantics -- `path.isAbsolute`) is used
 *   **unchanged** (`path.resolve(project)`, only lexically normalized),
 *   entirely independent of {@linkcode iacFolder}.
 * - A relative `project` is resolved against
 *   {@linkcode vscode.Uri.fsPath iacFolder.fsPath} (azd's project root -- the
 *   folder containing `azure.yaml`) via `path.resolve`, matching Go's
 *   `filepath.Join` -- including permitting `..` to traverse above
 *   {@linkcode iacFolder} to an ancestor directory, which azd itself does not
 *   reject.
 *
 * This is pure string/path-API use (no Node `fs` I/O) -- the resulting
 * host-native filesystem path is converted back to a {@linkcode vscode.Uri}
 * via `code.Uri.file` before the one and only I/O call,
 * {@linkcode vscode.FileSystem.stat workspace.fs.stat}, which is what
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

    const resolvedPath = path.isAbsolute(project) ? path.resolve(project) : path.resolve(iacFolder.fsPath, project);
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
