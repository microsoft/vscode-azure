/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, ICommandRegistry } from '@microsoft/vscode-azure-utils';
import { Container } from 'inversify';
import { AzdDownCommandId, AzdUpCommandId, LoadMoreCommandId } from '../constants';
import type { ManagedCommandRegistration } from '../registration/ProductRegistrar';
import { SelectSubscriptions } from './auth/SelectSubscriptions';
import { SignIn } from './auth/SignIn';
import { AzdDown } from './deploy/AzdDown';
import { AzdUp } from './deploy/AzdUp';
import { ClearActivities } from './deploy/ClearActivities';
import type { ManagedCommand } from './ManagedCommand';
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
export function registerCommands(
    container: Container,
    productCommands: readonly ManagedCommandRegistration[] = [],
): void {
    registerManagedCommand(container, 'vscode-azure/resources/refresh', RefreshResourcesView);
    registerManagedCommand(container, 'vscode-azure/resources/groupBy', GroupBy);
    registerManagedCommand(container, 'vscode-azure/resources/openInPortal', OpenInPortal);
    registerManagedCommand(container, 'vscode-azure/signIn', SignIn);
    registerManagedCommand(container, 'vscode-azure/selectSubscriptions', SelectSubscriptions);
    registerManagedCommand(container, LoadMoreCommandId, LoadMore);

    registerManagedCommand(container, 'vscode-azure/workspace/refresh', RefreshWorkspaceView);
    registerManagedCommand(container, 'vscode-azure/workspace/revealInExplorer', RevealInExplorer);

    registerManagedCommand(container, 'vscode-azure/activity/clearCompleted', ClearActivities, 'completed');
    registerManagedCommand(container, 'vscode-azure/activity/clearSuccessful', ClearActivities, 'successful');
    registerManagedCommand(container, 'vscode-azure/activity/clearAll', ClearActivities, 'all');

    registerManagedCommand(container, AzdUpCommandId, AzdUp);
    registerManagedCommand(container, AzdDownCommandId, AzdDown);
    registerManagedCommand(container, 'vscode-azure/installAzd', InstallAzd);

    for (const command of productCommands) {
        registerManagedCommand(container, command.commandId, command.commandClass, ...command.prefixArgs);
    }
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
