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
    // These objects are the absolute bare minimum to continue with the rest of the activation function
    // So they must be created before the container is set up
    const telemetryReporter: ITelemetryReporter = createTelemetryReporter(extensionContext);
    const executor: IActionExecutor = new ActionExecutor(telemetryReporter);

    return await executor.callWithTelemetryAndErrorHandling('activate', activateContext => {
        activateContext.telemetry.measurements.loadTimeMs = perfStats.loadEndTime - perfStats.loadStartTime;

        const container = setUpContainer(extensionContext, telemetryReporter, executor);

        registerCommands(container);
    });
}

export function deactivateInternal(): Promise<void> {
    return Promise.resolve();
}

function setUpContainer(extensionContext: IExtensionContext, telemetryReporter: ITelemetryReporter, executor: IActionExecutor): Container {
    const container = new Container();

    // These four come in as constants (vscode by import, others from above)
    container.bind(IVsCode).toConstantValue(vscode);
    container.bind(IExtensionContext).toConstantValue(extensionContext);
    container.bind(ITelemetryReporter).toConstantValue(telemetryReporter);
    container.bind(IActionExecutor).toConstantValue(executor);

    // Dynamically created and disposable objects
    container.bind(IOutputChannel).toDynamicValue((context) => {
        const outputChannel = createOutputChannel('Azure', context.get(IVsCode));
        context.get(IExtensionContext).subscriptions.push(outputChannel);
        return outputChannel;
    }).inSingletonScope();

    container.bind(ICommandRegistry).toDynamicValue((context) => {
        const registry = new CommandRegistry(
            context.get(IActionExecutor),
            context.get(IVsCode)
        );
        context.get(IExtensionContext).subscriptions.push(registry);
        return registry;
    }).inSingletonScope();

    return container;
}
