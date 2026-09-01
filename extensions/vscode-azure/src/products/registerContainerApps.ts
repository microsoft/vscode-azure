/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AcrRepositoryClient, ContainerAppsClient, IAcrRepositoryClientProvider,
    IContainerAppsClientProvider, ILogsQueryClientProvider, LogsQueryClient,
} from '@microsoft/vscode-azure-azutils';
import { CreateContainerApp } from '../commands/containerApps/CreateContainerApp';
import { OpenContainerAppConsole, OpenContainerAppLogs } from '../commands/containerApps/portalBlades';
import { RestartContainerApp } from '../commands/containerApps/RestartContainerApp';
import { RevealContainerAppEnvironment } from '../commands/containerApps/RevealContainerAppEnvironment';
import { StartStreamingLogs } from '../commands/containerApps/StartStreamingLogs';
import { OpenUrl } from '../commands/OpenUrl';
import type { ProductRegistrar } from '../registration/ProductRegistrar';
import { pushDisposable } from '../services';
import { ContainerAppLogStreamService, IContainerAppLogStreamService } from '../tree/resources/containerApps/ContainerAppLogStream';
import { ContainerAppsDataProvider } from '../tree/resources/containerApps/ContainerAppsDataProvider';
import { ContainerAppsViewProvider } from '../tree/resources/containerApps/ContainerAppsViewProvider';
import { containerAppsDetector } from '../tree/workspace/containerApps/containerAppsDetector';
import { IWorkspaceDetector } from '../utils/workspaceIndex/WorkspaceDetector';

/** Contribute all Azure Container Apps services and UI integrations. */
export function registerContainerApps(registrar: ProductRegistrar): void {
    registrar.registerAzureClientProvider(IContainerAppsClientProvider, (context, executor, credential, subscription) => {
        return ContainerAppsClient.create(context, executor, credential, subscription);
    });

    // Both are data-plane clients addressed by a service endpoint -- a registry
    // login server, a cloud's Log Analytics endpoint -- rather than by ARM.
    registrar.registerAzureClientProvider(IAcrRepositoryClientProvider, (context, executor, credential, subscription, loginServer) => {
        return AcrRepositoryClient.create(context, executor, credential, loginServer, subscription.environment);
    });
    registrar.registerAzureClientProvider(ILogsQueryClientProvider, (context, executor, credential, subscription) => {
        return LogsQueryClient.create(context, executor, credential, subscription.environment);
    });

    registrar.registerBinding(container => {
        container.bind(IContainerAppLogStreamService).to(ContainerAppLogStreamService).inSingletonScope().onActivation(pushDisposable);
        container.bind(IWorkspaceDetector).toConstantValue(containerAppsDetector);
    });

    registrar.registerResourceDataProvider(ContainerAppsDataProvider);
    registrar.registerResourceViewProvider(ContainerAppsViewProvider);

    registrar.registerCommand('vscode-azure/containerApps/openConsoleInPortal', OpenUrl, OpenContainerAppConsole.getUrl);
    registrar.registerCommand('vscode-azure/containerApps/openLogsInPortal', OpenUrl, OpenContainerAppLogs.getUrl);
    registrar.registerCommand('vscode-azure/containerApps/restart', RestartContainerApp);
    registrar.registerCommand('vscode-azure/containerApps/revealEnvironment', RevealContainerAppEnvironment);
    registrar.registerCommand('vscode-azure/containerApps/startStreamingLogs', StartStreamingLogs);
    registrar.registerCommand('vscode-azure/containerApps/createNew', CreateContainerApp, 'createNew');
    registrar.registerCommand('vscode-azure/containerApps/deploy', CreateContainerApp, 'deploy');
}
