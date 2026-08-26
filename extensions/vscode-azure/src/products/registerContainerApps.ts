/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AcrRepositoryClient, ContainerAppsClient, IAcrRepositoryClientProvider,
    IContainerAppsClientProvider, ILogsQueryClientProvider, LogsQueryClient,
} from '@microsoft/vscode-azure-azutils';
import { selfOnly } from '@microsoft/vscode-azure-utils';
import { CreateContainerApp } from '../commands/containerApps/CreateContainerApp';
import { OpenContainerAppConsole, OpenContainerAppLogs } from '../commands/containerApps/portalBlades';
import { RestartContainerApp } from '../commands/containerApps/RestartContainerApp';
import { RevealContainerAppEnvironment } from '../commands/containerApps/RevealContainerAppEnvironment';
import { StartStreamingLogs } from '../commands/containerApps/StartStreamingLogs';
import { StopStreamingLogs } from '../commands/containerApps/StopStreamingLogs';
import { OpenUrl } from '../commands/OpenUrl';
import type { ProductRegistrar } from '../registration/ProductRegistrar';
import { IAzureViewDataTree } from '../services';
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

    // Both are data-plane clients scoped to a service endpoint rather than to a
    // subscription's ARM endpoint.
    registrar.registerDataPlaneClientProvider(IAcrRepositoryClientProvider, (credential, subscription, loginServer) => {
        return AcrRepositoryClient.create(credential, loginServer, subscription.environment);
    });
    registrar.registerDataPlaneClientProvider(ILogsQueryClientProvider, (credential, subscription) => {
        return LogsQueryClient.create(credential, subscription.environment);
    });

    registrar.registerBinding(container => {
        container.bind(IContainerAppLogStreamService).to(ContainerAppLogStreamService).inSingletonScope();
        container.bind(IWorkspaceDetector).toConstantValue(containerAppsDetector);
    });

    registrar.registerResourceDataProvider(ContainerAppsDataProvider);
    registrar.registerResourceViewProvider(ContainerAppsViewProvider);

    registrar.registerCommand('vscode-azure/containerApps/openConsoleInPortal', OpenUrl, OpenContainerAppConsole.getUrl);
    registrar.registerCommand('vscode-azure/containerApps/openLogsInPortal', OpenUrl, OpenContainerAppLogs.getUrl);
    registrar.registerCommand('vscode-azure/containerApps/restart', RestartContainerApp);
    registrar.registerCommand('vscode-azure/containerApps/revealEnvironment', RevealContainerAppEnvironment);
    registrar.registerCommand('vscode-azure/containerApps/startStreamingLogs', StartStreamingLogs);
    registrar.registerCommand('vscode-azure/containerApps/stopStreamingLogs', StopStreamingLogs);
    registrar.registerCommand('vscode-azure/containerApps/createNew', CreateContainerApp, 'createNew');
    registrar.registerCommand('vscode-azure/containerApps/deploy', CreateContainerApp, 'deploy');

    // Whether a stream is open decides whether the app node offers to stop it,
    // so a change in the live set has to re-render that node. Only its label
    // changes, so its children stay cached.
    registrar.registerActivation(container => {
        const streams = container.get(IContainerAppLogStreamService);
        const tree = container.get(IAzureViewDataTree);

        streams.onDidChangeStreams(app => {
            tree.invalidate(selfOnly(app));
        });
    });
}
