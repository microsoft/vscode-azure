/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getResourceTypePresentation } from '@microsoft/vscode-azure-azutils';
import type { ICodeContext } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';

/**
 * Returns a {@linkcode vscode.Uri} pointing to an Azure resource icon SVG
 * whose path is selected by the resource's logical type.
 *
 * Callers should pass {@linkcode GenericResource.logicalType} rather than
 * the raw ARM `type`, because logical types disambiguate resources that
 * share the same ARM type (e.g. `Microsoft.Web/sites~functionapp` vs
 * `Microsoft.Web/sites~app`). For non-resource nodes such as subscriptions
 * or resource groups, pass the corresponding ARM type constant
 * (e.g. {@linkcode SubscriptionArmType}, {@linkcode ResourceGroupArmType}).
 *
 * The icon files are organized by provider namespace under `dist/azureIcons/`,
 * mirroring the ARM type structure. A resource type may use an icon key from
 * {@linkcode getResourceTypePresentation} when its icon is shared with another
 * logical type. For example, the logical type
 * `Microsoft.Web/sites~functionapp` resolves to
 * `dist/azureIcons/microsoft.web/sites~functionapp.svg`.
 *
 * To add a new icon, drop an SVG in the matching subfolder of
 * `packages/azutils/resources/azureIcons/` -- no code changes required.
 */
export function getResourceTypeIconUri(ctx: ICodeContext, resourceType: string): vscode.Uri {
    return getAzureIconUri(ctx, getResourceTypePresentation(ctx.code, resourceType)?.iconName ?? resourceType);
}


/**
 * Returns a {@linkcode vscode.Uri} pointing to an Azure icon SVG
 * under `dist/azureIcons/`. Unlike {@linkcode getResourceTypeIconUri},
 * this accepts an arbitrary icon name rather than a resource type,
 * allowing callers to reference icons that don't correspond to an
 * ARM type (e.g. `microsoft.web/sites~functionapp` for a workspace
 * Functions project node).
 */
export function getAzureIconUri(ctx: ICodeContext, iconName: string): vscode.Uri {
    return ctx.code.Uri.joinPath(ctx.extensionContext.extensionUri, 'dist', 'azureIcons', `${iconName.toLowerCase()}.svg`);
}
