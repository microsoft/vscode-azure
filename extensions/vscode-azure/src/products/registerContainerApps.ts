/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ContainerAppsClient, IContainerAppsClientProvider,
} from '@microsoft/vscode-azure-azutils';
import { CreateContainerApp } from '../commands/containerApps/CreateContainerApp';
import { OpenContainerAppConsole, OpenContainerAppLogs } from '../commands/containerApps/portalBlades';
import { RestartContainerApp } from '../commands/containerApps/RestartContainerApp';
import { RevealContainerAppEnvironment } from '../commands/containerApps/RevealContainerAppEnvironment';
import { StartStreamingLogs } from '../commands/containerApps/StartStreamingLogs';
import { VerifyContainerAppStart } from '../commands/containerApps/VerifyContainerAppStart';
import { OpenUrl } from '../commands/OpenUrl';
import type { ProductRegistrar } from '../registration/ProductRegistrar';
import { pushDisposable } from '../services';
import { ContainerAppLogStreamService, IContainerAppLogStreamService } from '../tree/resources/containerApps/ContainerAppLogStream';
import { ContainerAppsDataProvider } from '../tree/resources/containerApps/ContainerAppsDataProvider';
import { ContainerAppsViewProvider } from '../tree/resources/containerApps/ContainerAppsViewProvider';

/** Contribute all Azure Container Apps services and UI integrations. */
export function registerContainerApps(registrar: ProductRegistrar): void {
    registrar.registerAzureClientProvider(IContainerAppsClientProvider, ContainerAppsClient.create.bind(ContainerAppsClient));

    registrar.registerBinding(container => {
        container.bind(IContainerAppLogStreamService).to(ContainerAppLogStreamService).inSingletonScope().onActivation(pushDisposable);
    });

    registrar.registerResourceDataProvider(ContainerAppsDataProvider);
    registrar.registerResourceViewProvider(ContainerAppsViewProvider);

    registrar.registerCommand('vscode-azure/containerApps/openConsoleInPortal', OpenUrl, OpenContainerAppConsole.getUrl);
    registrar.registerCommand('vscode-azure/containerApps/openLogsInPortal', OpenUrl, OpenContainerAppLogs.getUrl);
    registrar.registerCommand('vscode-azure/containerApps/restart', RestartContainerApp);
    registrar.registerCommand('vscode-azure/containerApps/revealEnvironment', RevealContainerAppEnvironment);
    registrar.registerCommand(StartStreamingLogs.CommandId, StartStreamingLogs);
    registrar.registerCommand('vscode-azure/containerApps/createNew', CreateContainerApp, 'createNew');
    registrar.registerCommand('vscode-azure/containerApps/deploy', CreateContainerApp, 'deploy');
    registrar.registerCommand(VerifyContainerAppStart.CommandId, VerifyContainerAppStart);
}
