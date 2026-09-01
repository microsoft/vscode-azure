/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CaselessSet, readText, stringifyError, type ICaselessSetReader, type IVsCode } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';

/** File name used by the Azure Static Web Apps CLI for project configurations. */
export const SwaCliConfigFileName = 'swa-cli.config.json';

/**
 * Static Web Apps CLI options consumed by this extension.
 *
 * The CLI configuration schema supports additional options that remain owned by the CLI.
 */
export interface SWACLIOptions {
    readonly [option: string]: unknown;
    readonly appLocation?: string;
    readonly apiLocation?: string;
    readonly outputLocation?: string;
    readonly appBuildCommand?: string;
    readonly apiLanguage?: string;
}

/** Root shape of `swa-cli.config.json`. */
export interface StaticWebAppsCliConfigFile {
    readonly $schema?: string;
    readonly configurations?: Readonly<Record<string, SWACLIOptions>>;
}

/**
 * Build directories that hold a framework's server output rather than files
 * that can be served as-is.
 *
 * The Static Web Apps CLI reports one output location per framework, so a
 * server-rendered project and its static-export variant both resolve to the
 * server build. Uploading that as static content produces a broken site, so it
 * is treated the same as having no deployable output.
 */
const serverBuildLocations: ICaselessSetReader = new CaselessSet(['.next']);

/** Whether current azd can deploy the selected output as a distinct artifact directory. */
export function canAzdDeployStaticWebApp(outputLocation: string): boolean {
    const normalized = outputLocation.trim().replace(/\\/g, '/').replace(/^\.\//, '');
    return normalized.length > 0
        && normalized !== '/'
        && normalized !== '.'
        && !serverBuildLocations.has(normalized);
}

/**
 * Reads the canonical Static Web Apps CLI configuration from a workspace root.
 *
 * Missing files return `undefined`. Invalid JSON is surfaced with the file name
 * and parser detail so a user can repair the configuration.
 */
export async function tryGetStaticWebAppsCliConfig(
    code: IVsCode,
    workspaceFolder: vscode.Uri,
): Promise<StaticWebAppsCliConfigFile | undefined> {
    const configUri = code.Uri.joinPath(workspaceFolder, SwaCliConfigFileName);
    const contents = await readText(code, configUri);
    if (contents === undefined) {
        return undefined;
    }

    try {
        return JSON.parse(contents) as StaticWebAppsCliConfigFile;
    } catch (error) {
        throw new Error(code.l10n.t(
            "Unable to parse '{0}': {1}",
            SwaCliConfigFileName,
            stringifyError(error),
        ), { cause: error });
    }
}
