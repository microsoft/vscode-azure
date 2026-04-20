/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, ICommandRegistry, IOutputChannel } from '@microsoft/vscode-azure-utils';
import { Container } from 'inversify';
import { LoadMoreCommandId } from '../constants';
import { DisableAcrAdminUser } from './acr/DisableAcrAdminUser';
import { ClearActivities } from './ClearActivities';
import { AddOrEditAppSetting } from './functions/AddOrEditAppSetting';
import { CreateFunctionApp } from './functions/CreateFunctionApp';
import { DeleteAppSetting } from './functions/DeleteAppSetting';
import { GroupBy } from './GroupBy';
import { Hello } from './Hello';
import { LoadMore } from './LoadMore';
import type { ManagedCommand } from './ManagedCommand';
import { OpenInPortal } from './OpenInPortal';
import { RefreshResourcesView } from './RefreshResourcesView';
import { TrackArmDeployment } from './TrackArmDeployment';

/**
 * Registers every {@linkcode ManagedCommand} exposed by the extension
 * against the {@linkcode ICommandRegistry} bound on the container. Called
 * once from `activateInternal()` during activation.
 */
export function registerCommands(container: Container): void {
    const output = container.get(IOutputChannel);

    registerManagedCommand(container, output, 'azure.hello', Hello);

    registerManagedCommand(container, output, 'vscode-azure/resources/refresh', RefreshResourcesView);
    registerManagedCommand(container, output, 'vscode-azure/resources/groupBy', GroupBy);
    registerManagedCommand(container, output, 'vscode-azure/resources/openInPortal', OpenInPortal);
    registerManagedCommand(container, output, LoadMoreCommandId, LoadMore);

    registerManagedCommand(container, output, 'vscode-azure/acr/disableAdminUser', DisableAcrAdminUser);

    registerManagedCommand(container, output, 'vscode-azure/functionApp/appSettings/add', AddOrEditAppSetting, 'add');
    registerManagedCommand(container, output, 'vscode-azure/functionApp/appSettings/edit', AddOrEditAppSetting, 'edit');
    registerManagedCommand(container, output, 'vscode-azure/functionApp/appSettings/delete', DeleteAppSetting);

    registerManagedCommand(container, output, 'vscode-azure/activity/trackArmDeployment', TrackArmDeployment);
    registerManagedCommand(container, output, 'vscode-azure/activity/clearCompleted', ClearActivities, 'completed');
    registerManagedCommand(container, output, 'vscode-azure/activity/clearSuccessful', ClearActivities, 'successful');
    registerManagedCommand(container, output, 'vscode-azure/activity/clearAll', ClearActivities, 'all');

    registerManagedCommand(container, output, 'vscode-azure/functions/create', CreateFunctionApp);
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
    output: IOutputChannel,
    commandId: string,
    commandClass: new (...ctorArgs: any[]) => ManagedCommand, // eslint-disable-line @typescript-eslint/no-explicit-any
    ...prefixArgs: unknown[]
): void {
    output.debug('[cmd] registering %s', commandId);
    // Bind the command class if not already bound
    if (!container.isBound(commandClass)) {
        container.bind(commandClass).toSelf();
    }

    const registry = container.get(ICommandRegistry);
    registry.registerCommand(commandId, (context, ...args) => {
        // Create child container for this command execution
        const executionContainer = new Container({ parent: container });
        executionContainer.bind(IActionContext).toConstantValue(context);

        return executionContainer.get(commandClass).execute(...prefixArgs, ...args);
    });
}
