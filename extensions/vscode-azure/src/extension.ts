/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSCodeAzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import {
    AcrClient,
    DeploymentClient,
    IAcrClientProvider,
    IDeploymentClientProvider,
    IResourceClientProvider,
    ISubscriptionClientProvider,
    IWebAppClientProvider,
    ResourceClient,
    setUpAzureSdkLogging,
    SubscriptionClient,
    WebAppClient,
} from '@microsoft/vscode-azure-azutils';
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
    IProcessExecutor,
    ITelemetryReporter,
    IVsCode,
    ProcessExecutor,
} from '@microsoft/vscode-azure-utils';
import { TelemetryReporter } from '@vscode/extension-telemetry';
import { Container } from 'inversify';
import * as vscode from 'vscode'; // eslint-disable-line @typescript-eslint/no-restricted-imports -- This is the one place it should be imported
import { AzdAuthServer, IAzdAuthServer } from './azd/AzdAuthServer';
import { AzdService, IAzdService } from './azd/AzdService';
import { TempProjectManager } from './azd/wizard/TempProjectManager';
import { registerCommands } from './commands/registerCommands';
import { IAzureSubscriptionProvider, ITempProjectManager, pushDisposable } from './services';
import { registerTrees } from './tree/registerTrees';

/**
 * Entry point called by the generated extension `activate` function.
 *
 * Builds the DI container (unless one is supplied via {@linkcode containerOverride}),
 * then registers commands and tree views under a telemetry-wrapped `activate` event.
 *
 * @param extensionContext - The VS Code extension context.
 * @param perfStats - Timestamps used to report activation duration telemetry.
 * @param containerOverride - Optional pre-built container (used by tests and the
 *   "Run (Mock Data)" debug entry point).
 */
export async function activateInternal(
    extensionContext: vscode.ExtensionContext,
    perfStats: { loadStartTime: number, loadEndTime: number },
    containerOverride?: Container,
): Promise<void> {
    const container = containerOverride ?? setUpContainer(extensionContext);

    return await container.get(IActionExecutor).callWithTelemetryAndErrorHandling('activate', activateContext => {
        activateContext.telemetry.measurements.loadTimeMs = perfStats.loadEndTime - perfStats.loadStartTime;
        activateContext.telemetry.isUserEvent = false;

        registerCommands(container);
        registerTrees(container);
    });
}

/** Entry point called by the generated extension `deactivate` function. */
export function deactivateInternal(): Promise<void> {
    return Promise.resolve();
}

/**
 * Builds the root inversify container with all extension-level bindings.
 * Disposable services are registered with {@linkcode pushDisposable} so they
 * are torn down with the extension context.
 */
export function setUpContainer(extensionContext: IExtensionContext): Container {
    const container = new Container();
    const output = createOutputChannel('Azure', vscode);

    // These three come in as constants (vscode by import, context from above)
    container.bind(IVsCode).toConstantValue(vscode);
    container.bind(IExtensionContext).toConstantValue(extensionContext);
    container.bind(ICodeContext).toConstantValue({ code: vscode, extensionContext });

    // Register the SDK-logging disposable first so it is disposed (and
    // restores `AzureLogger.log`) before the output channel itself is
    // torn down; otherwise a late SDK log line during deactivation would
    // hit a disposed channel.
    extensionContext.subscriptions.push(setUpAzureSdkLogging(output), output);
    container.bind(IOutputChannel).toConstantValue(output);

    // Dynamically created singletons, some of which are disposable, but we do
    // `pushDisposable()` on all of them because it's smart enough to distinguish
    container.bind(IActionExecutor).toDynamicValue(context => {
        return new ActionExecutor(
            context.get(IVsCode),
            context.get(ITelemetryReporter),
            context.get(IExtensionContext).extension.id,
            context.get(IOutputChannel)
        );
    }).inSingletonScope().onActivation(pushDisposable);

    container.bind(ITelemetryReporter).toDynamicValue(context => {
        return createTelemetryReporter(context.get(IExtensionContext), TelemetryReporter);
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

    container.bind(IProcessExecutor).toDynamicValue(context => {
        return new ProcessExecutor(context.get(IVsCode));
    }).inSingletonScope().onActivation(pushDisposable);

    container.bind(IAzdService).to(AzdService).inSingletonScope().onActivation(pushDisposable);

    container.bind(IAzdAuthServer).to(AzdAuthServer).inSingletonScope().onActivation(pushDisposable);

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

    container.bind(ISubscriptionClientProvider).toFactory(context => {
        const ctx = context.get(ICodeContext);
        const executor = context.get(IActionExecutor);
        return (subscription) => SubscriptionClient.create(ctx, executor, subscription);
    });

    container.bind(IWebAppClientProvider).toFactory(context => {
        const ctx = context.get(ICodeContext);
        const executor = context.get(IActionExecutor);
        return (subscription) => WebAppClient.create(ctx, executor, subscription);
    });

    return container;
}
