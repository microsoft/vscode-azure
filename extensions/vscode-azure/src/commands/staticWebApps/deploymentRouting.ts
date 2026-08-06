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

/**
 * Reads `azure.yaml` in {@linkcode iacFolder} directly and returns the `dist`
 * value of its `host: staticwebapp` service, or `undefined` when no such
 * service is configured (or `azure.yaml`/the service can't be read/parsed).
 *
 * An empty string is a valid return value -- it means the service exists but
 * declares no (or an empty) `dist`, which {@linkcode canAzdDeployStaticWebApp}
 * from `./steps/locationUtils` correctly treats as unsupported.
 *
 * Used both to detect an existing `host: staticwebapp` service (standalone
 * command project resolution) and to derive direct-deploy/CI eligibility for
 * an already-hydrated project whose `outputLocation` was never captured by
 * the current wizard run (`OutputLocationStep` skips prompting once
 * `infra/main.bicep` already exists).
 */
export async function getStaticWebAppServiceDist(
    azd: IAzdService,
    code: IVsCode,
    iacFolder: vscode.Uri,
): Promise<string | undefined> {
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
            return typeof service.dist === 'string' ? service.dist : '';
        }
    }
    return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
