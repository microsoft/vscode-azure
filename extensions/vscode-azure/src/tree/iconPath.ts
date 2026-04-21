/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IExtensionContext, IVsCode } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';

/**
 * Returns a {@linkcode vscode.Uri} pointing to an Azure resource icon SVG file
 * located under `resources/icons/`.
 */
export function getAzureIconUri(code: IVsCode, extensionContext: IExtensionContext, iconName: string): vscode.Uri {
    return code.Uri.joinPath(extensionContext.extensionUri, 'resources', 'icons', `${iconName}.svg`);
}
