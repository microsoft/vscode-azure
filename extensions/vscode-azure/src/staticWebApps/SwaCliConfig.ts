/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { stringifyError, type IVsCode } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';

/** File name used by the Azure Static Web Apps CLI for project configurations. */
export const SwaCliConfigFileName = 'swa-cli.config.json';

/**
 * File name of the Static Web Apps runtime configuration -- routes, auth, and
 * response overrides. Present in a deployed project whether or not the CLI is
 * used locally.
 */
export const StaticWebAppConfigFileName = 'staticwebapp.config.json';

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
    readonly outputLocation?: string;
    readonly files?: readonly string[];
}

/** Root shape of `swa-cli.config.json`. */
export interface StaticWebAppsCliConfigFile {
    readonly configurations?: Readonly<Record<string, SWACLIOptions>>;
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
    try {
        await code.workspace.fs.stat(configUri);
    } catch (error) {
        if (isFileNotFound(error)) {
            return undefined;
        }
        throw error;
    }

    const contents = new TextDecoder().decode(await code.workspace.fs.readFile(configUri));
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

function isFileNotFound(error: unknown): boolean {
    return !!error
        && typeof error === 'object'
        && 'code' in error
        && error.code === 'FileNotFound';
}
