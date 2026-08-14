/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWebAppClientProvider, WebAppClient } from '@microsoft/vscode-azure-azutils';
import { CreateFunctionApp } from '../commands/functions/CreateFunctionApp';
import type { ProductRegistrar } from '../registration/ProductRegistrar';
import { WebAppSettingsAdapter } from '../settings/adapters/WebAppSettingsAdapter';
import { ISettingsAdapter } from '../settings/SettingsAdapter';

/** Contribute all Azure Functions services and UI integrations. */
export function registerFunctions(registrar: ProductRegistrar): void {
    registrar.registerAzureClientProvider(IWebAppClientProvider, (context, executor, credential, subscription) => {
        return WebAppClient.create(context, executor, credential, subscription);
    });

    // Adapters are multi-injected into the settings registry, so adding a product is one line.
    registrar.registerBinding(container => {
        container.bind(ISettingsAdapter).to(WebAppSettingsAdapter).inSingletonScope();
    });

    registrar.registerCommand('vscode-azure/functions/createNew', CreateFunctionApp, 'createNew');
    registrar.registerCommand('vscode-azure/functions/deploy', CreateFunctionApp, 'deploy');
}
