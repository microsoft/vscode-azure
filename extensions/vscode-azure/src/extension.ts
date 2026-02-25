/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSCodeAzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
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
import { IAzureSubscriptionProvider, pushDisposable } from './services';
import { registerTrees } from './tree/registerTrees';

export async function activateInternal(extensionContext: vscode.ExtensionContext, perfStats: { loadStartTime: number, loadEndTime: number }): Promise<void> {
    const container = setUpContainer(extensionContext);

    return await container.get(IActionExecutor).callWithTelemetryAndErrorHandling('activate', activateContext => {
        activateContext.telemetry.measurements.loadTimeMs = perfStats.loadEndTime - perfStats.loadStartTime;
        activateContext.telemetry.properties.isActivationEvent = 'true';

        registerCommands(container);
        registerTrees(container);
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

    // Dynamically created singletons, some of which are disposable, but we do
    // `pushDisposable()` on all of them because it's smart enough to distinguish
    container.bind(IActionExecutor).toDynamicValue(context => {
        return new ActionExecutor(context.get(ITelemetryReporter));
    }).inSingletonScope().onActivation(pushDisposable);

    container.bind(ITelemetryReporter).toDynamicValue(context => {
        return createTelemetryReporter(context.get(IExtensionContext));
    }).inSingletonScope().onActivation(pushDisposable);

    container.bind(IOutputChannel).toDynamicValue(context => {
        return createOutputChannel('Azure', context.get(IVsCode));
    }).inSingletonScope().onActivation(pushDisposable);

    container.bind(ICommandRegistry).toDynamicValue(context => {
        return new CommandRegistry(
            context.get(IActionExecutor),
            context.get(IVsCode)
        );
    }).inSingletonScope().onActivation(pushDisposable);

    container.bind(IAzureSubscriptionProvider).toDynamicValue(context => {
        return new VSCodeAzureSubscriptionProvider(context.get(IOutputChannel));
    }).inSingletonScope().onActivation(pushDisposable);

    return container;
}
