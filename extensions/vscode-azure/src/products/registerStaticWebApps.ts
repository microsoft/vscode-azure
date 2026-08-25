/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStaticWebAppClientProvider, StaticWebAppClient } from '@microsoft/vscode-azure-azutils';
import { IExtensionContext, IVsCode } from '@microsoft/vscode-azure-utils';
import { DeployStaticWebAppCommandId } from '../constants';
import { CreateStaticWebApp } from '../commands/staticWebApps/CreateStaticWebApp';
import { CreateSwaConfigFile } from '../commands/staticWebApps/CreateSwaConfigFile';
import { DeleteStaticWebAppEnvironment } from '../commands/staticWebApps/DeleteStaticWebAppEnvironment';
import { DeployStaticWebApp } from '../commands/staticWebApps/DeployStaticWebApp';
import { ShowFunctionsDocumentation, ShowStaticWebAppsDocumentation } from '../commands/staticWebApps/ShowDocumentation';
import { OpenUrl } from '../commands/OpenUrl';
import { StaticWebAppCommandResolver } from '../commands/staticWebApps/StaticWebAppCommandResolver';
import { ViewStaticWebAppProperties } from '../commands/staticWebApps/ViewStaticWebAppProperties';
import { PwaChromeDebugType, SwaDebugConfigurationProvider, SwaDebugType } from '../debug/staticWebApps/SwaDebugConfigurationProvider';
import type { ProductRegistrar } from '../registration/ProductRegistrar';
import { pushDisposable } from '../services';
import { StaticWebAppSettingsAdapter } from '../settings/adapters/StaticWebAppSettingsAdapter';
import { GitRemoteService, IGitRemoteService } from '../staticWebApps/GitRemoteService';
import { staticWebAppDatabaseDetector } from '../staticWebApps/DatabaseConfigDetector';
import { SwaTaskLifecycle } from '../tasks/staticWebApps/SwaTaskLifecycle';
import { IProcessTerminator, ProcessTerminator } from '../utils/ProcessTerminator';
import { IWorkspaceDetector } from '../utils/workspaceIndex/WorkspaceDetector';
import { SwaTaskProvider } from '../tasks/staticWebApps/SwaTaskProvider';
import { IStaticWebAppDataProvider, StaticWebAppDataProvider } from '../tree/resources/staticWebApps/StaticWebAppDataProvider';
import { StaticWebAppViewProvider } from '../tree/resources/staticWebApps/StaticWebAppViewProvider';

/** Contribute all Azure Static Web Apps services and UI integrations. */
export function registerStaticWebApps(registrar: ProductRegistrar): void {
    registrar.registerAzureClientProvider(IStaticWebAppClientProvider, (context, executor, credential, subscription) => {
        return StaticWebAppClient.create(context, executor, credential, subscription);
    });

    registrar.registerBinding(container => {
        container.bind(StaticWebAppCommandResolver).toSelf();
        container.bind(StaticWebAppSettingsAdapter).toSelf().inSingletonScope();
        container.bind(IGitRemoteService).to(GitRemoteService).inSingletonScope();
        container.bind(IWorkspaceDetector).toConstantValue(staticWebAppDatabaseDetector);
        container.bind(SwaTaskProvider).toSelf().inSingletonScope();
        container.bind(SwaDebugConfigurationProvider).toSelf().inSingletonScope();
        container.bind(IProcessTerminator).to(ProcessTerminator).inSingletonScope();
        container.bind(SwaTaskLifecycle).toSelf().inSingletonScope().onActivation(pushDisposable);
    });

    registrar.registerCommand('vscode-azure/staticWebApps/createNew', CreateStaticWebApp, 'basic');
    registrar.registerCommand('vscode-azure/staticWebApps/createAdvanced', CreateStaticWebApp, 'advanced');
    registrar.registerCommand('vscode-azure/staticWebApps/deleteEnvironment', DeleteStaticWebAppEnvironment);
    registrar.registerCommand(DeployStaticWebAppCommandId, DeployStaticWebApp);
    registrar.registerCommand('vscode-azure/staticWebApps/createSwaConfigFile', CreateSwaConfigFile);
    registrar.registerCommand('vscode-azure/staticWebApps/showDocumentation', OpenUrl, ShowStaticWebAppsDocumentation.Url);
    registrar.registerCommand('vscode-azure/staticWebApps/showFunctionsDocumentation', OpenUrl, ShowFunctionsDocumentation.Url);
    registrar.registerCommand('vscode-azure/staticWebApps/viewProperties', ViewStaticWebAppProperties);

    registrar.registerResourceDataProvider([IStaticWebAppDataProvider, StaticWebAppDataProvider]);
    registrar.registerResourceViewProvider(StaticWebAppViewProvider);

    registrar.registerActivation(container => {
        const code = container.get(IVsCode);
        const extensionContext = container.get(IExtensionContext);
        const taskProvider = container.get(SwaTaskProvider);
        const debugProvider = container.get(SwaDebugConfigurationProvider);

        extensionContext.subscriptions.push(
            code.tasks.registerTaskProvider('shell', taskProvider),
            code.debug.registerDebugConfigurationProvider(PwaChromeDebugType, debugProvider),
            code.debug.registerDebugConfigurationProvider(
                SwaDebugType,
                debugProvider,
                code.DebugConfigurationProviderTriggerKind.Dynamic,
            ),
            code.debug.registerDebugConfigurationProvider(
                SwaDebugType,
                debugProvider,
                code.DebugConfigurationProviderTriggerKind.Initial,
            ),
        );
    });

    // Resolve the lifecycle eagerly so its task event subscriptions are active.
    registrar.registerActivation(container => {
        container.get(SwaTaskLifecycle);
    });
}
