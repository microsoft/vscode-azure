/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContainerAppsClient, IContainerAppsClientProvider } from '@microsoft/vscode-azure-azutils';
import { OpenContainerAppConsole, OpenContainerAppLogs } from '../commands/containerApps/portalBlades';
import { OpenUrl } from '../commands/OpenUrl';
import type { ProductRegistrar } from '../registration/ProductRegistrar';
import { ContainerAppsDataProvider } from '../tree/resources/containerApps/ContainerAppsDataProvider';
import { ContainerAppsViewProvider } from '../tree/resources/containerApps/ContainerAppsViewProvider';

/** Contribute all Azure Container Apps services and UI integrations. */
export function registerContainerApps(registrar: ProductRegistrar): void {
    registrar.registerAzureClientProvider(IContainerAppsClientProvider, (context, executor, credential, subscription) => {
        return ContainerAppsClient.create(context, executor, credential, subscription);
    });

    registrar.registerResourceDataProvider(ContainerAppsDataProvider);
    registrar.registerResourceViewProvider(ContainerAppsViewProvider);

    registrar.registerCommand('vscode-azure/containerApps/openConsoleInPortal', OpenUrl, OpenContainerAppConsole.getUrl);
    registrar.registerCommand('vscode-azure/containerApps/openLogsInPortal', OpenUrl, OpenContainerAppLogs.getUrl);
}
