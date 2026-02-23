/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ActionExecutor,
    CommandRegistry,
    createOutputChannel,
    createTelemetryReporter,
    IActionExecutor,
    ICommandRegistry,
    IExtensionContext,
    IOutputChannel,
    ITelemetryReporter,
    IVsCode,
} from '@microsoft/vscode-azure-utils';
import { Container } from 'inversify';
import * as vscode from 'vscode';
import { registerCommands } from './commands/registerCommands';

export async function activateInternal(extensionContext: vscode.ExtensionContext, perfStats: { loadStartTime: number, loadEndTime: number }): Promise<void> {
    const container = setUpContainer(extensionContext);

    return await container.get(IActionExecutor).callWithTelemetryAndErrorHandling('activate', activateContext => {
        activateContext.telemetry.measurements.loadTimeMs = perfStats.loadEndTime - perfStats.loadStartTime;
        activateContext.telemetry.properties.isActivationEvent = 'true';

        registerCommands(container);
    });
}

export function deactivateInternal(): Promise<void> {
    return Promise.resolve();
}

function setUpContainer(extensionContext: IExtensionContext): Container {
    const container = new Container();

    // These two come in as constants (vscode by import, context from above)
    container.bind(IVsCode).toConstantValue(vscode);
    container.bind(IExtensionContext).toConstantValue(extensionContext);

    // Dynamically created singletons
    container.bind(IActionExecutor).toDynamicValue(context => {
        return new ActionExecutor(context.get(ITelemetryReporter));
    }).inSingletonScope();

    // Dynamically created, disposable singletons
    container.bind(ITelemetryReporter).toDynamicValue(context => {
        const reporter = createTelemetryReporter(context.get(IExtensionContext));
        context.get(IExtensionContext).subscriptions.push(reporter);
        return reporter;
    }).inSingletonScope();

    container.bind(IOutputChannel).toDynamicValue(context => {
        const outputChannel = createOutputChannel('Azure', context.get(IVsCode));
        context.get(IExtensionContext).subscriptions.push(outputChannel);
        return outputChannel;
    }).inSingletonScope();

    container.bind(ICommandRegistry).toDynamicValue(context => {
        const registry = new CommandRegistry(
            context.get(IActionExecutor),
            context.get(IVsCode)
        );
        context.get(IExtensionContext).subscriptions.push(registry);
        return registry;
    }).inSingletonScope();

    return container;
}
