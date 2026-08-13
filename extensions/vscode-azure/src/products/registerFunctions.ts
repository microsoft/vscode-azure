/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWebAppClientProvider, WebAppClient } from '@microsoft/vscode-azure-azutils';
import { AddOrEditAppSetting } from '../commands/functions/AddOrEditAppSetting';
import { CreateFunctionApp } from '../commands/functions/CreateFunctionApp';
import { DeleteAppSetting } from '../commands/functions/DeleteAppSetting';
import type { ProductRegistrar } from '../registration/ProductRegistrar';
import { FunctionAppDataProvider, IFunctionAppDataProvider } from '../tree/resources/functions/FunctionAppDataProvider';
import { FunctionAppViewProvider } from '../tree/resources/functions/FunctionAppViewProvider';
import { createFunctionsProjectDetector } from '../workspace/detectors/functionsProjectDetector';

/** Contribute all Azure Functions services and UI integrations. */
export function registerFunctions(registrar: ProductRegistrar): void {
    registrar.registerWorkspaceDetector(createFunctionsProjectDetector());

    registrar.registerAzureClientProvider(IWebAppClientProvider, (context, executor, credential, subscription) => {
        return WebAppClient.create(context, executor, credential, subscription);
    });

    registrar.registerCommand('vscode-azure/functionApp/appSettings/add', AddOrEditAppSetting, 'add');
    registrar.registerCommand('vscode-azure/functionApp/appSettings/edit', AddOrEditAppSetting, 'edit');
    registrar.registerCommand('vscode-azure/functionApp/appSettings/delete', DeleteAppSetting);
    registrar.registerCommand('vscode-azure/functions/createNew', CreateFunctionApp, 'createNew');
    registrar.registerCommand('vscode-azure/functions/deploy', CreateFunctionApp, 'deploy');

    registrar.registerResourceDataProvider([IFunctionAppDataProvider, FunctionAppDataProvider]);
    registrar.registerResourceViewProvider(FunctionAppViewProvider);
}
