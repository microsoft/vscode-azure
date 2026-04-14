/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, type VirtualResource } from '@microsoft/vscode-azure-azutils';
import { FunctionAppVirtualPaths, FunctionAppVirtualTypes } from './FunctionApp';

/**
 * Construct the parent "App Settings" category key from an individual
 * app setting's {@link VirtualResource}.
 *
 * Uses {@link AzureNodeId.from} to produce the canonical key, avoiding
 * manual string/encoding manipulation.
 */
export function appSettingsParentKey(settingResource: VirtualResource): string {
    const parent: VirtualResource = {
        virtualType: FunctionAppVirtualTypes.AppSettings,
        virtualPath: FunctionAppVirtualPaths.AppSettings,
        azureResource: settingResource.azureResource,
    };
    return AzureNodeId.from(parent).toString();
}
