/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContainerAppsClient, IContainerAppsClientProvider } from '@microsoft/vscode-azure-azutils';
import { selfOnly } from '@microsoft/vscode-azure-utils';
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

/** Contribute all Azure Container Apps services and UI integrations. */
export function registerContainerApps(registrar: ProductRegistrar): void {
    registrar.registerAzureClientProvider(IContainerAppsClientProvider, (context, executor, credential, subscription) => {
        return ContainerAppsClient.create(context, executor, credential, subscription);
    });

    registrar.registerBinding(container => {
        container.bind(IContainerAppLogStreamService).to(ContainerAppLogStreamService).inSingletonScope();
    });

    registrar.registerResourceDataProvider(ContainerAppsDataProvider);
    registrar.registerResourceViewProvider(ContainerAppsViewProvider);

    registrar.registerCommand('vscode-azure/containerApps/openConsoleInPortal', OpenUrl, OpenContainerAppConsole.getUrl);
    registrar.registerCommand('vscode-azure/containerApps/openLogsInPortal', OpenUrl, OpenContainerAppLogs.getUrl);
    registrar.registerCommand('vscode-azure/containerApps/restart', RestartContainerApp);
    registrar.registerCommand('vscode-azure/containerApps/revealEnvironment', RevealContainerAppEnvironment);
    registrar.registerCommand('vscode-azure/containerApps/startStreamingLogs', StartStreamingLogs);
    registrar.registerCommand('vscode-azure/containerApps/stopStreamingLogs', StopStreamingLogs);

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
