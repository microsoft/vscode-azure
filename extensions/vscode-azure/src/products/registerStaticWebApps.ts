/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStaticWebAppClientProvider, StaticWebAppClient } from '@microsoft/vscode-azure-azutils';
import { IActionExecutor, IOutputChannel, IProcessExecutor, IVsCode } from '@microsoft/vscode-azure-utils';
import { DeployStaticWebAppCommandId } from '../constants';
import { CancelAction, RerunAction } from '../commands/staticWebApps/ActionCommands';
import { BrowseStaticWebApp } from '../commands/staticWebApps/BrowseStaticWebApp';
import { CloneRepository } from '../commands/staticWebApps/CloneRepository';
import { CreateStaticWebApp } from '../commands/staticWebApps/CreateStaticWebApp';
import { CreateSwaConfigFile } from '../commands/staticWebApps/CreateSwaConfigFile';
import { DeleteStaticWebAppEnvironment } from '../commands/staticWebApps/DeleteStaticWebAppEnvironment';
import { DeployStaticWebApp } from '../commands/staticWebApps/DeployStaticWebApp';
import { InstallOrUpdateSwaCli } from '../commands/staticWebApps/InstallOrUpdateSwaCli';
import { OpenGitHubLog } from '../commands/staticWebApps/OpenGitHubLog';
import { OpenGitHubRepository } from '../commands/staticWebApps/OpenGitHubRepository';
import { OpenWorkflowConfigFile } from '../commands/staticWebApps/OpenWorkflowConfigFile';
import { ShowFunctionsDocumentation, ShowStaticWebAppsDocumentation } from '../commands/staticWebApps/ShowDocumentation';
import { ShowGitHubActions } from '../commands/staticWebApps/ShowGitHubActions';
import { StaticWebAppCommandResolver } from '../commands/staticWebApps/StaticWebAppCommandResolver';
import { UninstallSwaCli } from '../commands/staticWebApps/UninstallSwaCli';
import { ViewStaticWebAppProperties } from '../commands/staticWebApps/ViewStaticWebAppProperties';
import { SwaDebugConfigurationProvider } from '../debug/staticWebApps/SwaDebugConfigurationProvider';
import type { ProductRegistrar } from '../registration/ProductRegistrar';
import { pushDisposable } from '../services';
import { IStaticWebAppsGitHubService, StaticWebAppsGitHubService } from '../services/StaticWebAppsGitHubService';
import { GitHubActionLogContentProvider } from '../staticWebApps/GitHubActionLogContentProvider';
import { GitRemoteService, IGitRemoteService } from '../staticWebApps/GitRemoteService';
import { registerStaticWebAppLocalTools } from '../staticWebApps/registerStaticWebAppLocalTools';
import { ISwaCliService, SwaCliService } from '../staticWebApps/SwaCliService';
import { IProcessTerminator, ProcessTerminator, SwaTaskLifecycle } from '../tasks/staticWebApps/SwaTaskLifecycle';
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
        container.bind(IStaticWebAppsGitHubService).to(StaticWebAppsGitHubService).inSingletonScope();
        container.bind(IGitRemoteService).to(GitRemoteService).inSingletonScope();
        container.bind(ISwaCliService).toDynamicValue(context => new SwaCliService(
            context.get(IVsCode),
            context.get(IProcessExecutor),
            context.get(IOutputChannel),
            context.get(IActionExecutor),
        )).inSingletonScope();
        container.bind(SwaTaskProvider).toSelf().inSingletonScope();
        container.bind(SwaDebugConfigurationProvider).toSelf().inSingletonScope();
        container.bind(GitHubActionLogContentProvider).toSelf().inSingletonScope().onActivation(pushDisposable);
        container.bind(IProcessTerminator).to(ProcessTerminator).inSingletonScope();
        container.bind(SwaTaskLifecycle).toSelf().inSingletonScope().onActivation(pushDisposable);
    });

    registrar.registerCommand('vscode-azure/staticWebApps/browse', BrowseStaticWebApp);
    registrar.registerCommand('vscode-azure/staticWebApps/createNew', CreateStaticWebApp, 'basic');
    registrar.registerCommand('vscode-azure/staticWebApps/createAdvanced', CreateStaticWebApp, 'advanced');
    registrar.registerCommand('vscode-azure/staticWebApps/cloneRepo', CloneRepository);
    registrar.registerCommand('vscode-azure/staticWebApps/openGitHubRepo', OpenGitHubRepository);
    registrar.registerCommand('vscode-azure/staticWebApps/openGitHubLog', OpenGitHubLog);
    registrar.registerCommand('vscode-azure/staticWebApps/showActions', ShowGitHubActions);
    registrar.registerCommand('vscode-azure/staticWebApps/action/cancel', CancelAction);
    registrar.registerCommand('vscode-azure/staticWebApps/action/rerun', RerunAction);
    registrar.registerCommand('vscode-azure/staticWebApps/deleteEnvironment', DeleteStaticWebAppEnvironment);
    registrar.registerCommand(DeployStaticWebAppCommandId, DeployStaticWebApp);
    registrar.registerCommand('vscode-azure/staticWebApps/createSwaConfigFile', CreateSwaConfigFile);
    registrar.registerCommand('vscode-azure/staticWebApps/openWorkflowConfigFile', OpenWorkflowConfigFile);
    registrar.registerCommand('vscode-azure/staticWebApps/showDocumentation', ShowStaticWebAppsDocumentation);
    registrar.registerCommand('vscode-azure/staticWebApps/showFunctionsDocumentation', ShowFunctionsDocumentation);
    registrar.registerCommand('vscode-azure/staticWebApps/viewProperties', ViewStaticWebAppProperties);
    registrar.registerCommand('vscode-azure/staticWebApps/installOrUpdateCli', InstallOrUpdateSwaCli);
    registrar.registerCommand('vscode-azure/staticWebApps/uninstallCli', UninstallSwaCli);

    registrar.registerResourceDataProvider([IStaticWebAppDataProvider, StaticWebAppDataProvider]);
    registrar.registerResourceViewProvider(StaticWebAppViewProvider);

    registrar.registerActivation(registerStaticWebAppLocalTools);
}
