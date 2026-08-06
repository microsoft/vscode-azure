/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AcrClient, IAcrClientProvider } from '@microsoft/vscode-azure-azutils';
import { DisableAcrAdminUser } from '../../commands/acr/DisableAcrAdminUser';
import type { ProductRegistrar } from '../../registration/ProductRegistrar';
import { AcrDataProvider } from '../../tree/resources/acr/AcrDataProvider';
import { AcrViewProvider } from '../../tree/resources/acr/AcrViewProvider';

/** Contribute all Azure Container Registry services and UI integrations. */
export function registerAcr(registrar: ProductRegistrar): void {
    registrar.registerAzureClientProvider(IAcrClientProvider, (context, executor, credential, subscription) => {
        return AcrClient.create(context, executor, credential, subscription);
    });
    registrar.registerCommand('vscode-azure/acr/disableAdminUser', DisableAcrAdminUser);
    registrar.registerResourceDataProvider(AcrDataProvider);
    registrar.registerResourceViewProvider(AcrViewProvider);
}
