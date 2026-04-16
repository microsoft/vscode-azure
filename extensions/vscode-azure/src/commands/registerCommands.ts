/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, ICommandRegistry } from '@microsoft/vscode-azure-utils';
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

export function registerCommands(container: Container): void {
    registerManagedCommand(container, 'azure.hello', Hello);

    registerManagedCommand(container, 'vscode-azure/resources/refresh', RefreshResourcesView);
    registerManagedCommand(container, 'vscode-azure/resources/groupBy', GroupBy);
    registerManagedCommand(container, 'vscode-azure/resources/openInPortal', OpenInPortal);
    registerManagedCommand(container, LoadMoreCommandId, LoadMore);

    registerManagedCommand(container, 'vscode-azure/acr/disableAdminUser', DisableAcrAdminUser);

    registerManagedCommand(container, 'vscode-azure/functionApp/appSettings/add', AddOrEditAppSetting, 'add');
    registerManagedCommand(container, 'vscode-azure/functionApp/appSettings/edit', AddOrEditAppSetting, 'edit');
    registerManagedCommand(container, 'vscode-azure/functionApp/appSettings/delete', DeleteAppSetting);

    registerManagedCommand(container, 'vscode-azure/activity/trackArmDeployment', TrackArmDeployment);
    registerManagedCommand(container, 'vscode-azure/activity/clearCompleted', ClearActivities, 'completed');
    registerManagedCommand(container, 'vscode-azure/activity/clearSuccessful', ClearActivities, 'successful');
    registerManagedCommand(container, 'vscode-azure/activity/clearAll', ClearActivities, 'all');

    registerManagedCommand(container, 'vscode-azure/functions/create', CreateFunctionApp);
}

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
        // Create child container for this command execution
        const executionContainer = new Container({ parent: container });
        executionContainer.bind(IActionContext).toConstantValue(context);

        return executionContainer.get(commandClass).execute(...prefixArgs, ...args);
    });
}
