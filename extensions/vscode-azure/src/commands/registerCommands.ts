/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, ICommandRegistry } from '@microsoft/vscode-azure-utils';
import { Container } from 'inversify';
import { Hello } from './Hello';
import type { ManagedCommand } from './ManagedCommand';

export function registerCommands(container: Container): void {
    registerManagedCommand(container, 'azure.hello', Hello);
}

function registerManagedCommand(
    container: Container,
    commandId: string,
    commandClass: new (...ctorArgs: never[]) => ManagedCommand
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

        return executionContainer.get(commandClass).execute(...args);
    });
}
