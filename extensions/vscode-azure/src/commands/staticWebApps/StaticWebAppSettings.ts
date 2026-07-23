/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IVsCode } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';
import { ConfigurationSection } from '../../constants';

/** Migrated Static Web Apps path settings under {@linkcode ConfigurationSection}. */
export const StaticWebAppPathSettings = {
    appLocation: 'staticWebApps.appSubpath',
    apiLocation: 'staticWebApps.apiSubpath',
    outputLocation: 'staticWebApps.outputSubpath',
} as const;

/** Reads a workspace-scoped Static Web Apps path setting. */
export function getStaticWebAppPathSetting(
    code: IVsCode,
    key: keyof typeof StaticWebAppPathSettings,
    scope?: vscode.Uri,
): string | undefined {
    return code.workspace.getConfiguration(ConfigurationSection, scope).get<string>(StaticWebAppPathSettings[key]);
}
