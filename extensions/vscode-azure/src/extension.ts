/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSCodeAzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import { AcrClient, DeploymentClient, ResourceClient } from '@microsoft/vscode-azure-azutils';
import {
    ActionExecutor,
    CommandRegistry,
    createOutputChannel,
    createTelemetryReporter,
    IActionExecutor,
    ICodeContext,
    ICommandRegistry,
    IExtensionContext,
    IOutputChannel,
    ITelemetryReporter,
    IVsCode,
} from '@microsoft/vscode-azure-utils';
import { TelemetryReporter } from '@vscode/extension-telemetry';
import { Container } from 'inversify';
import * as vscode from 'vscode'; // eslint-disable-line @typescript-eslint/no-restricted-imports -- This is the one place it should be imported
import { TempProjectManager } from './bicep/TempProjectManager';
import { registerCommands } from './commands/registerCommands';
import { IAcrClientProvider, IAzureSubscriptionProvider, IDeploymentClientProvider, IResourceClientProvider, ITempProjectManager, pushDisposable } from './services';
import { registerTrees } from './tree/registerTrees';

export async function activateInternal(extensionContext: vscode.ExtensionContext, perfStats: { loadStartTime: number, loadEndTime: number }): Promise<void> {
    const container = setUpContainer(extensionContext);

    return await container.get(IActionExecutor).callWithTelemetryAndErrorHandling('activate', activateContext => {
        activateContext.telemetry.measurements.loadTimeMs = perfStats.loadEndTime - perfStats.loadStartTime;
        activateContext.telemetry.isUserEvent = false;

        registerCommands(container);
        registerTrees(container);
    });
}

export function deactivateInternal(): Promise<void> {
    return Promise.resolve();
}

function setUpContainer(extensionContext: IExtensionContext): Container {
    const container = new Container();

    // These three come in as constants (vscode by import, context from above)
    container.bind(IVsCode).toConstantValue(vscode);
    container.bind(IExtensionContext).toConstantValue(extensionContext);
    container.bind(ICodeContext).toConstantValue({ code: vscode, extensionContext });

    // Dynamically created singletons, some of which are disposable, but we do
    // `pushDisposable()` on all of them because it's smart enough to distinguish
    container.bind(IActionExecutor).toDynamicValue(context => {
        return new ActionExecutor(context.get(ITelemetryReporter));
    }).inSingletonScope().onActivation(pushDisposable);

    container.bind(ITelemetryReporter).toDynamicValue(context => {
        return createTelemetryReporter(context.get(IExtensionContext), TelemetryReporter);
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

    container.bind(ITempProjectManager).to(TempProjectManager).inSingletonScope().onActivation(pushDisposable);

    container.bind(IResourceClientProvider).toFactory(context => {
        const ctx = context.get(ICodeContext);
        const executor = context.get(IActionExecutor);
        return (subscription) => ResourceClient.create(ctx, executor, subscription);
    });

    container.bind(IDeploymentClientProvider).toFactory(context => {
        const ctx = context.get(ICodeContext);
        const executor = context.get(IActionExecutor);
        return (subscription) => DeploymentClient.create(ctx, executor, subscription);
    });

    container.bind(IAcrClientProvider).toFactory(context => {
        const ctx = context.get(ICodeContext);
        const executor = context.get(IActionExecutor);
        return (subscription) => AcrClient.create(ctx, executor, subscription);
    });

    return container;
}
