/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWebAppClientProvider, WebAppClient } from '@microsoft/vscode-azure-azutils';
import { CreateFunctionApp } from '../commands/functions/CreateFunctionApp';
import { WebAppLifecycle } from '../commands/webApp/WebAppLifecycle';
import type { ProductRegistrar } from '../registration/ProductRegistrar';
import { WebAppSettingsAdapter } from '../settings/adapters/WebAppSettingsAdapter';
import { WebAppDataProvider } from '../tree/resources/webApp/WebAppDataProvider';
import { WebAppViewProvider } from '../tree/resources/webApp/WebAppViewProvider';
import { functionsDetector } from '../tree/workspace/functions/FunctionsWorkspaceDataProvider';
import { IWorkspaceDetector } from '../utils/workspaceIndex/WorkspaceDetector';

/** Contribute all Azure Functions services and UI integrations. */
export function registerFunctions(registrar: ProductRegistrar): void {
    registrar.registerAzureClientProvider(IWebAppClientProvider, WebAppClient.create.bind(WebAppClient));

    // Registered once here for every Microsoft.Web/sites flavor; App Service and Logic Apps reuse
    // this shared ownership rather than registering duplicate providers.
    registrar.registerBinding(container => {
        container.bind(WebAppSettingsAdapter).toSelf().inSingletonScope();
    });

    registrar.registerResourceDataProvider(WebAppDataProvider);
    registrar.registerResourceViewProvider(WebAppViewProvider);
    registrar.registerCommand('vscode-azure/functions/createNew', CreateFunctionApp, 'createNew');
    registrar.registerCommand('vscode-azure/functions/deploy', CreateFunctionApp, 'deploy');
    registrar.registerCommand('vscode-azure/webApp/start', WebAppLifecycle, 'start');
    registrar.registerCommand('vscode-azure/webApp/stop', WebAppLifecycle, 'stop');
    registrar.registerCommand('vscode-azure/webApp/restart', WebAppLifecycle, 'restart');

    registrar.registerBinding(container => {
        container.bind(IWorkspaceDetector).toConstantValue(functionsDetector);
    });
}
