/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IExtensionContext, IVsCode } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';

/**
 * Returns a {@linkcode vscode.Uri} pointing to an Azure resource icon SVG
 * whose path is derived from the resource's logical type.
 *
 * Callers should pass {@linkcode GenericResource.logicalType} rather than
 * the raw ARM `type`, because logical types disambiguate resources that
 * share the same ARM type (e.g. `Microsoft.Web/sites~functionapp` vs
 * `Microsoft.Web/sites~app`). For non-resource nodes such as subscriptions
 * or resource groups, pass the corresponding ARM type constant
 * (e.g. {@linkcode SubscriptionArmType}, {@linkcode ResourceGroupArmType}).
 *
 * The icon files are organized by provider namespace under `dist/azureIcons/`,
 * mirroring the ARM type structure. For example, the logical type
 * `Microsoft.Web/sites~functionapp` resolves to
 * `dist/azureIcons/microsoft.web/sites~functionapp.svg`.
 *
 * To add a new icon, drop an SVG in the matching subfolder of
 * `packages/azutils/resources/azureIcons/` -- no code changes required.
 *
 * // TODO: future: scan the azureIcons directory lazily and fall back to a
 * // ThemeIcon when no matching SVG exists. Currently VS Code shows no icon
 * // if the path is invalid.
 */
export function getResourceTypeIconUri(code: IVsCode, extensionContext: IExtensionContext, resourceType: string): vscode.Uri {
    return code.Uri.joinPath(extensionContext.extensionUri, 'dist', 'azureIcons', `${resourceType.toLowerCase()}.svg`);
}
