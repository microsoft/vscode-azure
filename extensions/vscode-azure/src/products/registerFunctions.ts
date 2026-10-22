/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FunctionsHostClient, IFunctionsHostClientProvider, ILogsQueryClientProvider, IWebAppClientProvider, LogsQueryClient, WebAppClient } from '@microsoft/vscode-azure-azutils';
import { IActionExecutor, ICodeContext } from '@microsoft/vscode-azure-utils';
import { CreateFunctionApp } from '../commands/functions/CreateFunctionApp';
import { InitializeFunctionsProject } from '../commands/functions/InitializeFunctionsProject';
import { FunctionsProjectSelector } from '../functions/FunctionsProjectSelector';
import { FunctionsDebugPreparation } from '../functions/debug/FunctionsDebugPreparation';
import { FunctionsDebugProvider } from '../functions/debug/FunctionsDebugProvider';
import { LocalFunctionsNetwork } from '../functions/host/LocalFunctionsNetwork';
import { LocalFunctionsHostProcess } from '../functions/host/LocalFunctionsHostProcess';
import { IOwnedFunctionsHostSessionProvider, OwnedFunctionsHostSession } from '../functions/host/OwnedFunctionsHostSession';
import { FunctionUrlResolver } from '../functions/FunctionUrlResolver';
import { CopyFunctionUrl } from '../commands/functions/CopyFunctionUrl';
import { DeleteFunction } from '../commands/functions/DeleteFunction';
import { ExecuteFunction } from '../commands/functions/ExecuteFunction';
import { RevealFunctionAppIdentity } from '../commands/functions/RevealFunctionAppIdentity';
import { SetFunctionState } from '../commands/functions/SetFunctionState';
import { StreamFunctionLogs } from '../commands/functions/StreamFunctionLogs';
import { WebAppLifecycle } from '../commands/webApp/WebAppLifecycle';
import type { ProductRegistrar } from '../registration/ProductRegistrar';
import { pushDisposable } from '../services';
import { LocalFunctionSettings } from '../functions/LocalFunctionSettings';
import { LocalFunctionTarget } from '../functions/LocalFunctionTarget';
import { FunctionsProjectReader } from '../functions/FunctionsProjectReader';
import { LocalFunctionsHostTracker } from '../functions/host/LocalFunctionsHostTracker';
import { WebAppSettingsAdapter } from '../settings/adapters/WebAppSettingsAdapter';
import { WebAppDataProvider } from '../tree/resources/webApp/WebAppDataProvider';
import { FunctionAppDataProvider } from '../tree/resources/webApp/FunctionAppDataProvider';
import { FunctionAppViewProvider } from '../tree/resources/webApp/FunctionAppViewProvider';
import { FunctionAppLogStream } from '../tree/resources/webApp/FunctionAppLogStream';
import { WebAppViewProvider } from '../tree/resources/webApp/WebAppViewProvider';
import { functionsDetector } from '../functions/functionsDetector';
import { IWorkspaceDetector } from '../utils/workspaceIndex/WorkspaceDetector';

/** Contribute all Azure Functions services and UI integrations. */
export function registerFunctions(registrar: ProductRegistrar): void {
    registrar.registerAzureClientProvider(IWebAppClientProvider, WebAppClient.create.bind(WebAppClient));
    registrar.registerAzureClientProvider(ILogsQueryClientProvider, LogsQueryClient.create.bind(LogsQueryClient));
    registrar.registerBinding(container => {
        container.bind(IFunctionsHostClientProvider).toFactory(() => target =>
            FunctionsHostClient.create(container.get(ICodeContext), container.get(IActionExecutor), target));
    });

    // Registered once here for every Microsoft.Web/sites flavor; App Service and Logic Apps reuse
    // this shared ownership rather than registering duplicate providers.
    registrar.registerBinding(container => {
        container.bind(WebAppSettingsAdapter).toSelf().inSingletonScope();
        container.bind(LocalFunctionSettings).toSelf().inSingletonScope();
        container.bind(LocalFunctionTarget).toSelf();
        container.bind(FunctionUrlResolver).toSelf();
        container.bind(FunctionsProjectReader).toSelf();
        container.bind(LocalFunctionsHostTracker).toSelf().inSingletonScope().onActivation(pushDisposable);
        container.bind(FunctionsProjectSelector).toSelf().inSingletonScope();
        container.bind(FunctionsDebugPreparation).toSelf().inSingletonScope();
        container.bind(LocalFunctionsNetwork).toSelf().inSingletonScope();
        container.bind(OwnedFunctionsHostSession).toSelf();
        container.bind(IOwnedFunctionsHostSessionProvider).toFactory(context => () => context.get(OwnedFunctionsHostSession));
        container.bind(LocalFunctionsHostProcess).toSelf().inSingletonScope().onActivation(pushDisposable);
        container.bind(FunctionsDebugProvider).toSelf().inSingletonScope().onActivation(pushDisposable);
        container.bind(FunctionAppLogStream).toSelf().inSingletonScope().onActivation(pushDisposable);
    });

    registrar.registerResourceDataProvider(FunctionAppDataProvider);
    registrar.registerResourceDataProvider(WebAppDataProvider);
    registrar.registerResourceViewProvider(FunctionAppViewProvider);
    registrar.registerResourceViewProvider(WebAppViewProvider);
    registrar.registerCommand('vscode-azure/functions/createNew', CreateFunctionApp);
    registrar.registerCommand('vscode-azure/functions/initializeProject', InitializeFunctionsProject);
    registrar.registerActivation(container => { container.get(FunctionsDebugProvider).register(); });
    registrar.registerCommand('vscode-azure/webApp/start', WebAppLifecycle, 'start');
    registrar.registerCommand('vscode-azure/webApp/stop', WebAppLifecycle, 'stop');
    registrar.registerCommand('vscode-azure/webApp/restart', WebAppLifecycle, 'restart');
    registrar.registerCommand('vscode-azure/functions/execute', ExecuteFunction);
    registrar.registerCommand('vscode-azure/functions/copyUrl', CopyFunctionUrl);
    registrar.registerCommand('vscode-azure/functions/enable', SetFunctionState, false);
    registrar.registerCommand('vscode-azure/functions/disable', SetFunctionState, true);
    registrar.registerCommand('vscode-azure/functions/delete', DeleteFunction);
    registrar.registerCommand('vscode-azure/functions/streamLogs', StreamFunctionLogs);
    registrar.registerCommand('vscode-azure/functions/revealIdentity', RevealFunctionAppIdentity);

    registrar.registerBinding(container => {
        container.bind(IWorkspaceDetector).toConstantValue(functionsDetector);
    });
}
