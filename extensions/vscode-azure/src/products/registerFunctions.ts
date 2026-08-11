/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWebAppClientProvider, WebAppClient } from '@microsoft/vscode-azure-azutils';
import { CreateFunctionApp } from '../commands/functions/CreateFunctionApp';
import type { ProductRegistrar } from '../registration/ProductRegistrar';

/** Contribute all Azure Functions services and UI integrations. */
export function registerFunctions(registrar: ProductRegistrar): void {
    registrar.registerAzureClientProvider(IWebAppClientProvider, (context, executor, credential, subscription) => {
        return WebAppClient.create(context, executor, credential, subscription);
    });

    registrar.registerCommand('vscode-azure/functions/createNew', CreateFunctionApp, 'createNew');
    registrar.registerCommand('vscode-azure/functions/deploy', CreateFunctionApp, 'deploy');

    // No tree providers: a Function App's only children are its settings, which the shared settings
    // product contributes generically. Adding a provider here would claim the resource and take it
    // away from the generic path -- see docs/tree-views.md.
}
