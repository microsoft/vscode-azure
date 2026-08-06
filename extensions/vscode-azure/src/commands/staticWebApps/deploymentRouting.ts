/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IVsCode } from '@microsoft/vscode-azure-utils';
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
 * directory URI, mirroring azd's own `ServiceConfig.Path()` semantics
 * exactly: an absolute `project` (POSIX `/...` or a Windows drive letter
 * `C:...`) is used **unchanged**, and a relative `project` is resolved
 * against {@linkcode iacFolder} (the folder containing `azure.yaml` -- azd's
 * project root) via a plain path join, matching Go's `filepath.Join`. Both
 * `/` and Windows `\` separators are normalized first. Critically, azd does
 * **not** reject a relative `project` whose `..` segments traverse above the
 * project root (`filepath.Join`/`filepath.Clean` happily resolve `..` past
 * the root to an ancestor directory) -- so this function must not either;
 * only non-existence, or resolving to a file rather than a directory, makes
 * a path invalid.
 *
 * Returns `undefined` -- meaning `'invalidServiceConfig'`, never a silent
 * fallback to scanning {@linkcode iacFolder} itself -- for any of:
 * - a missing/empty `project` (required; never assumed to default to the
 *   IaC folder -- azd itself requires a `project` on every service),
 * - a path that doesn't exist, or that exists but isn't a directory (e.g. it
 *   names a file).
 *
 * Existence/directory-ness is verified via
 * {@linkcode vscode.FileSystem.stat workspace.fs.stat} -- callers must not
 * run framework detection or grant eligibility before this check succeeds.
 */
export async function resolveStaticWebAppServiceProjectFolder(
    code: IVsCode,
    iacFolder: vscode.Uri,
    project: string | undefined,
): Promise<vscode.Uri | undefined> {
    if (!project) {
        return undefined;
    }

    // Normalize Windows-style separators to the POSIX form azd/Uri expect.
    const normalized = project.replace(/\\/g, '/');
    const isAbsolute = normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized);

    // An absolute project path is azd's own project root, entirely unrelated to iacFolder --
    // Uri.file resolves it directly (rather than Uri.joinPath, which would incorrectly anchor
    // it under iacFolder as just another path segment).
    // A relative path resolves against iacFolder via a plain join -- Uri.joinPath performs the
    // same lexical `.`/`..` normalization as Go's filepath.Join, including permitting `..` to
    // traverse above iacFolder, so no manual segment-walking/rejection is needed or correct here.
    const projectFolder = isAbsolute ? code.Uri.file(normalized) : code.Uri.joinPath(iacFolder, normalized);

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
