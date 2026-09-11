/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStaticWebAppClientProvider, StaticWebAppClient } from '@microsoft/vscode-azure-azutils';
import { CreateStaticWebApp } from '../commands/staticWebApps/CreateStaticWebApp';
import { CreateSwaConfigFile } from '../commands/staticWebApps/CreateSwaConfigFile';
import { DeleteStaticWebAppEnvironment } from '../commands/staticWebApps/DeleteStaticWebAppEnvironment';
import { ShowFunctionsDocumentation, ShowStaticWebAppsDocumentation } from '../commands/staticWebApps/ShowDocumentation';
import { OpenUrl } from '../commands/OpenUrl';
import { IPropertiesAdapter } from '../properties/PropertiesAdapter';
import { StaticWebAppEnvironmentPropertiesAdapter } from '../properties/adapters/StaticWebAppEnvironmentPropertiesAdapter';
import type { ProductRegistrar } from '../registration/ProductRegistrar';
import { StaticWebAppSettingsAdapter } from '../settings/adapters/StaticWebAppSettingsAdapter';
import { ISwaCliService, SwaCliService } from '../staticWebApps/SwaCliService';
import { IStaticWebAppDataProvider, StaticWebAppDataProvider } from '../tree/resources/staticWebApps/StaticWebAppDataProvider';
import { StaticWebAppViewProvider } from '../tree/resources/staticWebApps/StaticWebAppViewProvider';

/** Contribute all Azure Static Web Apps services and UI integrations. */
export function registerStaticWebApps(registrar: ProductRegistrar): void {
    registrar.registerAzureClientProvider(IStaticWebAppClientProvider, StaticWebAppClient.create.bind(StaticWebAppClient));

    registrar.registerBinding(container => {
        container.bind(StaticWebAppSettingsAdapter).toSelf().inSingletonScope();
        container.bind(ISwaCliService).to(SwaCliService).inSingletonScope();
        container.bind(IPropertiesAdapter).to(StaticWebAppEnvironmentPropertiesAdapter).inSingletonScope();
    });

    registrar.registerCommand('vscode-azure/staticWebApps/createNew', CreateStaticWebApp);
    registrar.registerCommand('vscode-azure/staticWebApps/deleteEnvironment', DeleteStaticWebAppEnvironment);
    registrar.registerCommand('vscode-azure/staticWebApps/createSwaConfigFile', CreateSwaConfigFile);
    registrar.registerCommand('vscode-azure/staticWebApps/showDocumentation', OpenUrl, ShowStaticWebAppsDocumentation.Url);
    registrar.registerCommand('vscode-azure/staticWebApps/showFunctionsDocumentation', OpenUrl, ShowFunctionsDocumentation.Url);

    registrar.registerResourceDataProvider([IStaticWebAppDataProvider, StaticWebAppDataProvider]);
    registrar.registerResourceViewProvider(StaticWebAppViewProvider);
}
