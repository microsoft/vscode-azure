/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readText, stringifyError, type IVsCode } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';

/** File name used by the Azure Static Web Apps CLI for project configurations. */
export const SwaCliConfigFileName = 'swa-cli.config.json';

/** Complete option surface accepted by a named Static Web Apps CLI configuration. */
export interface SWACLIOptions {
    readonly context?: string;
    /** Directory containing `staticwebapp.database.config.json`. */
    readonly dataApiLocation?: string;
    readonly port?: number;
    readonly host?: string;
    readonly apiPort?: number;
    readonly ssl?: boolean;
    readonly apiPrefix?: 'api';
    readonly sslCert?: string;
    readonly sslKey?: string;
    readonly swaConfigFilename?: 'staticwebapp.config.json';
    readonly swaConfigFilenameLegacy?: 'routes.json';
    readonly app?: string;
    readonly apiLocation?: string;
    readonly apiLanguage?: string;
    readonly apiVersion?: string;
    readonly build?: boolean;
    readonly verbose?: string;
    readonly run?: string;
    readonly swaConfigLocation?: string;
    readonly customUrlScheme?: string;
    readonly overridableErrorCode?: readonly number[];
    readonly devserverTimeout?: number;
    readonly funcArgs?: string;
    readonly appBuildCommand?: string;
    readonly apiBuildCommand?: string;
    readonly appLocation?: string;
    readonly appDevserverUrl?: string;
    readonly apiDevserverUrl?: string;
    readonly outputLocation?: string;
    readonly files?: readonly string[];
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
const serverBuildLocations: readonly string[] = ['.next'];

/** Whether current azd can deploy the selected output as a distinct artifact directory. */
export function canAzdDeployStaticWebApp(outputLocation: string): boolean {
    const normalized = outputLocation.trim().replace(/\\/g, '/').replace(/^\.\//, '');
    return normalized.length > 0
        && normalized !== '/'
        && normalized !== '.'
        && !serverBuildLocations.includes(normalized.toLowerCase());
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

/**
 * Reads the Static Web Apps CLI configuration a user has already authored.
 *
 * @remarks
 * This file is the canonical home for a project's layout: it names every path
 * identically, `swa init` writes it, and `azd deploy` reaches those paths by
 * running `swa build`, which reads it. Preferring it keeps one source of truth
 * instead of a parallel copy the user has to keep in sync.
 *
 * A configuration file may declare several named configurations. Neither azd
 * nor this extension passes `--config-name`, and in that case the CLI resolves
 * the first one, so this mirrors that rather than inventing its own rule -- the
 * values returned are the ones a later `swa build` would actually use. A
 * malformed file is treated as absent, since failing a creation wizard over it
 * would be hostile.
 */
export async function tryGetStaticWebAppCliOptions(
    code: IVsCode,
    workspaceFolder: vscode.Uri | undefined,
): Promise<SWACLIOptions | undefined> {
    if (!workspaceFolder) {
        return undefined;
    }

    let config: StaticWebAppsCliConfigFile | undefined;
    try {
        config = await tryGetStaticWebAppsCliConfig(code, workspaceFolder);
    } catch {
        return undefined;
    }

    return Object.values(config?.configurations ?? {})[0];
}
