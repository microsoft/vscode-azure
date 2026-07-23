/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, ICommandRegistry } from '@microsoft/vscode-azure-utils';
import { Container } from 'inversify';
import { AzdDownCommandId, AzdUpCommandId, LoadMoreCommandId } from '../constants';
import { DisableAcrAdminUser } from './acr/DisableAcrAdminUser';
import { SelectSubscriptions } from './auth/SelectSubscriptions';
import { SignIn } from './auth/SignIn';
import { AzdDown } from './deploy/AzdDown';
import { AzdUp } from './deploy/AzdUp';
import { ClearActivities } from './deploy/ClearActivities';
import { AddOrEditAppSetting } from './functions/AddOrEditAppSetting';
import { CreateFunctionApp } from './functions/CreateFunctionApp';
import { DeleteAppSetting } from './functions/DeleteAppSetting';
import type { ManagedCommand } from './ManagedCommand';
import { CancelAction, RerunAction } from './staticWebApps/ActionCommands';
import { BrowseStaticWebApp } from './staticWebApps/BrowseStaticWebApp';
import { CloneRepository } from './staticWebApps/CloneRepository';
import { CreateSwaConfigFile } from './staticWebApps/CreateSwaConfigFile';
import { CreateStaticWebApp } from './staticWebApps/CreateStaticWebApp';
import { DeleteStaticWebApp } from './staticWebApps/DeleteStaticWebApp';
import { DeleteStaticWebAppEnvironment } from './staticWebApps/DeleteStaticWebAppEnvironment';
import { InstallOrUpdateSwaCli } from './staticWebApps/InstallOrUpdateSwaCli';
import { OpenGitHubLog } from './staticWebApps/OpenGitHubLog';
import { OpenGitHubRepository } from './staticWebApps/OpenGitHubRepository';
import { OpenWorkflowConfigFile } from './staticWebApps/OpenWorkflowConfigFile';
import { ShowFunctionsDocumentation, ShowStaticWebAppsDocumentation } from './staticWebApps/ShowDocumentation';
import { ShowGitHubActions } from './staticWebApps/ShowGitHubActions';
import {
    ManageStaticWebAppAppSetting,
    ToggleStaticWebAppAppSettingVisibility,
    TransferStaticWebAppAppSettings,
} from './staticWebApps/StaticWebAppAppSettingsCommands';
import { StaticWebAppCommandResolver } from './staticWebApps/StaticWebAppCommandResolver';
import { UninstallSwaCli } from './staticWebApps/UninstallSwaCli';
import { ViewStaticWebAppProperties } from './staticWebApps/ViewStaticWebAppProperties';
import { InstallAzd } from './tools/InstallAzd';
import { GroupBy } from './tree/GroupBy';
import { LoadMore } from './tree/LoadMore';
import { OpenInPortal } from './tree/OpenInPortal';
import { RefreshResourcesView } from './tree/RefreshResourcesView';
import { RefreshWorkspaceView } from './tree/RefreshWorkspaceView';
import { RevealInExplorer } from './tree/RevealInExplorer';

/**
 * Registers every {@linkcode ManagedCommand} exposed by the extension
 * against the {@linkcode ICommandRegistry} bound on the container. Called
 * once from `activateInternal()` during activation.
 */
export function registerCommands(container: Container): void {
    if (!container.isBound(StaticWebAppCommandResolver)) {
        container.bind(StaticWebAppCommandResolver).toSelf();
    }

    registerManagedCommand(container, 'vscode-azure/resources/refresh', RefreshResourcesView);
    registerManagedCommand(container, 'vscode-azure/resources/groupBy', GroupBy);
    registerManagedCommand(container, 'vscode-azure/resources/openInPortal', OpenInPortal);
    registerManagedCommand(container, 'vscode-azure/signIn', SignIn);
    registerManagedCommand(container, 'vscode-azure/selectSubscriptions', SelectSubscriptions);
    registerManagedCommand(container, LoadMoreCommandId, LoadMore);

    registerManagedCommand(container, 'vscode-azure/workspace/refresh', RefreshWorkspaceView);
    registerManagedCommand(container, 'vscode-azure/workspace/revealInExplorer', RevealInExplorer);

    registerManagedCommand(container, 'vscode-azure/acr/disableAdminUser', DisableAcrAdminUser);

    registerManagedCommand(container, 'vscode-azure/functionApp/appSettings/add', AddOrEditAppSetting, 'add');
    registerManagedCommand(container, 'vscode-azure/functionApp/appSettings/edit', AddOrEditAppSetting, 'edit');
    registerManagedCommand(container, 'vscode-azure/functionApp/appSettings/delete', DeleteAppSetting);

    registerManagedCommand(container, 'vscode-azure/activity/clearCompleted', ClearActivities, 'completed');
    registerManagedCommand(container, 'vscode-azure/activity/clearSuccessful', ClearActivities, 'successful');
    registerManagedCommand(container, 'vscode-azure/activity/clearAll', ClearActivities, 'all');

    registerManagedCommand(container, 'vscode-azure/functions/createNew', CreateFunctionApp, 'createNew');
    registerManagedCommand(container, 'vscode-azure/functions/deploy', CreateFunctionApp, 'deploy');

    registerManagedCommand(container, 'vscode-azure/staticWebApps/browse', BrowseStaticWebApp);
    registerManagedCommand(container, 'vscode-azure/staticWebApps/createNew', CreateStaticWebApp, 'basic');
    registerManagedCommand(container, 'vscode-azure/staticWebApps/createAdvanced', CreateStaticWebApp, 'advanced');
    registerManagedCommand(container, 'vscode-azure/staticWebApps/cloneRepo', CloneRepository);
    registerManagedCommand(container, 'vscode-azure/staticWebApps/openGitHubRepo', OpenGitHubRepository);
    registerManagedCommand(container, 'vscode-azure/staticWebApps/openGitHubLog', OpenGitHubLog);
    registerManagedCommand(container, 'vscode-azure/staticWebApps/showActions', ShowGitHubActions);
    registerManagedCommand(container, 'vscode-azure/staticWebApps/action/cancel', CancelAction);
    registerManagedCommand(container, 'vscode-azure/staticWebApps/action/rerun', RerunAction);
    registerManagedCommand(container, 'vscode-azure/staticWebApps/deleteEnvironment', DeleteStaticWebAppEnvironment);
    registerManagedCommand(container, 'vscode-azure/staticWebApps/deleteStaticWebApp', DeleteStaticWebApp);
    registerManagedCommand(container, 'vscode-azure/staticWebApps/createSwaConfigFile', CreateSwaConfigFile);
    registerManagedCommand(container, 'vscode-azure/staticWebApps/openWorkflowConfigFile', OpenWorkflowConfigFile);
    registerManagedCommand(container, 'vscode-azure/staticWebApps/showDocumentation', ShowStaticWebAppsDocumentation);
    registerManagedCommand(container, 'vscode-azure/staticWebApps/showFunctionsDocumentation', ShowFunctionsDocumentation);
    registerManagedCommand(container, 'vscode-azure/staticWebApps/viewProperties', ViewStaticWebAppProperties);
    registerManagedCommand(container, 'vscode-azure/staticWebApps/appSettings/add', ManageStaticWebAppAppSetting, 'add');
    registerManagedCommand(container, 'vscode-azure/staticWebApps/appSettings/edit', ManageStaticWebAppAppSetting, 'edit');
    registerManagedCommand(container, 'vscode-azure/staticWebApps/appSettings/rename', ManageStaticWebAppAppSetting, 'rename');
    registerManagedCommand(container, 'vscode-azure/staticWebApps/appSettings/delete', ManageStaticWebAppAppSetting, 'delete');
    registerManagedCommand(container, 'vscode-azure/staticWebApps/appSettings/download', TransferStaticWebAppAppSettings, 'download');
    registerManagedCommand(container, 'vscode-azure/staticWebApps/appSettings/upload', TransferStaticWebAppAppSettings, 'upload');
    registerManagedCommand(container, 'vscode-azure/staticWebApps/toggleAppSettingVisibility', ToggleStaticWebAppAppSettingVisibility);
    registerManagedCommand(container, 'vscode-azure/staticWebApps/installOrUpdateCli', InstallOrUpdateSwaCli);
    registerManagedCommand(container, 'vscode-azure/staticWebApps/uninstallCli', UninstallSwaCli);

    registerManagedCommand(container, AzdUpCommandId, AzdUp);
    registerManagedCommand(container, AzdDownCommandId, AzdDown);
    registerManagedCommand(container, 'vscode-azure/installAzd', InstallAzd);
}

/**
 * Binds {@linkcode commandClass} onto the container (if not already bound) and
 * wires it up so VS Code can invoke it via {@linkcode commandId}. Each invocation
 * creates a child container with the current {@linkcode IActionContext}, resolves
 * the command instance, and calls its {@linkcode ManagedCommand.execute execute}
 * method with {@linkcode prefixArgs} followed by the arguments passed by VS Code.
 */
function registerManagedCommand(
    container: Container,
    commandId: string,
    commandClass: new (...ctorArgs: any[]) => ManagedCommand, // eslint-disable-line @typescript-eslint/no-explicit-any
    ...prefixArgs: unknown[]
): void {
    // Bind the command class if not already bound
    if (!container.isBound(commandClass)) {
        container.bind(commandClass).toSelf();
    }

    const registry = container.get(ICommandRegistry);
    registry.registerCommand(commandId, (context, ...args) => {
        // Create child container for this command execution. autobind lets the
        // command resolve wizard steps (and other @injectable classes) with
        // executionContainer.get(Step) -- no explicit binding needed -- while
        // their IActionContext resolves to this execution's context.
        const executionContainer = new Container({ parent: container, autobind: true });
        executionContainer.bind(IActionContext).toConstantValue(context);
        // Bind the container to itself so commands can @inject(Container) and
        // resolve their wizard steps from this execution scope.
        executionContainer.bind(Container).toConstantValue(executionContainer);

        return executionContainer.get(commandClass).execute(...prefixArgs, ...args);
    });
}
