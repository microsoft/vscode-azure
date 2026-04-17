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
    ITelemetryReporter,
    IVsCode,
} from '@microsoft/vscode-azure-utils';
import { TelemetryReporter } from '@vscode/extension-telemetry';
import { Container } from 'inversify';
import * as vscode from 'vscode'; // eslint-disable-line @typescript-eslint/no-restricted-imports -- This is the one place it should be imported
import { registerCommands } from './commands/registerCommands';
import { IAzureSubscriptionProvider, ITempProjectManager, pushDisposable, traceBinding } from './services';
import { registerTrees } from './tree/registerTrees';
import { TempProjectManager } from './wizard/azd/TempProjectManager';

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
    const output = container.get(IOutputChannel);
    output.info(vscode.l10n.t('[activate] Starting Azure extension activation'));

    try {
        await container.get(IActionExecutor).callWithTelemetryAndErrorHandling('activate', activateContext => {
            activateContext.telemetry.measurements.loadTimeMs = perfStats.loadEndTime - perfStats.loadStartTime;
            activateContext.telemetry.isUserEvent = false;

            output.debug('[activate] Registering commands');
            registerCommands(container);
            output.debug('[activate] Registering tree views');
            registerTrees(container);
        });
        output.info(vscode.l10n.t('[activate] Azure extension is ready'));
    } catch (error) {
        output.error(vscode.l10n.t('[activate] Activation failed'));
        output.error(error instanceof Error ? error : new Error(String(error)));
        throw error;
    }
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
    traceBinding(output, 'IVsCode');
    container.bind(IVsCode).toConstantValue(vscode);
    traceBinding(output, 'IExtensionContext');
    container.bind(IExtensionContext).toConstantValue(extensionContext);
    traceBinding(output, 'ICodeContext');
    container.bind(ICodeContext).toConstantValue({ code: vscode, extensionContext });

    traceBinding(output, 'IOutputChannel');
    // Register the SDK-logging disposable first so it is disposed (and
    // restores `AzureLogger.log`) before the output channel itself is
    // torn down; otherwise a late SDK log line during deactivation would
    // hit a disposed channel.
    extensionContext.subscriptions.push(setUpAzureSdkLogging(output), output);
    container.bind(IOutputChannel).toConstantValue(output);

    // Dynamically created singletons, some of which are disposable, but we do
    // `pushDisposable()` on all of them because it's smart enough to distinguish
    traceBinding(output, 'IActionExecutor');
    container.bind(IActionExecutor).toDynamicValue(context => {
        return new ActionExecutor(context.get(ITelemetryReporter), context.get(IOutputChannel));
    }).inSingletonScope().onActivation(pushDisposable);

    traceBinding(output, 'ITelemetryReporter');
    container.bind(ITelemetryReporter).toDynamicValue(context => {
        return createTelemetryReporter(context.get(IExtensionContext), TelemetryReporter);
    }).inSingletonScope().onActivation(pushDisposable);

    traceBinding(output, 'ICommandRegistry');
    container.bind(ICommandRegistry).toDynamicValue(context => {
        return new CommandRegistry(
            context.get(IActionExecutor),
            context.get(IVsCode)
        );
    }).inSingletonScope().onActivation(pushDisposable);

    traceBinding(output, 'IAzureSubscriptionProvider');
    container.bind(IAzureSubscriptionProvider).toDynamicValue(context => {
        return new VSCodeAzureSubscriptionProvider(context.get(IOutputChannel));
    }).inSingletonScope().onActivation(pushDisposable);

    traceBinding(output, 'ITempProjectManager');
    container.bind(ITempProjectManager).to(TempProjectManager).inSingletonScope().onActivation(pushDisposable);

    traceBinding(output, 'IResourceClientProvider');
    container.bind(IResourceClientProvider).toFactory(context => {
        const ctx = context.get(ICodeContext);
        const executor = context.get(IActionExecutor);
        const boundOutput = context.get(IOutputChannel);
        return (subscription) => ResourceClient.create(ctx, executor, boundOutput, subscription);
    });

    traceBinding(output, 'IDeploymentClientProvider');
    container.bind(IDeploymentClientProvider).toFactory(context => {
        const ctx = context.get(ICodeContext);
        const executor = context.get(IActionExecutor);
        const boundOutput = context.get(IOutputChannel);
        return (subscription) => DeploymentClient.create(ctx, executor, boundOutput, subscription);
    });

    traceBinding(output, 'IAcrClientProvider');
    container.bind(IAcrClientProvider).toFactory(context => {
        const ctx = context.get(ICodeContext);
        const executor = context.get(IActionExecutor);
        const boundOutput = context.get(IOutputChannel);
        return (subscription) => AcrClient.create(ctx, executor, boundOutput, subscription);
    });

    traceBinding(output, 'ISubscriptionClientProvider');
    container.bind(ISubscriptionClientProvider).toFactory(context => {
        const ctx = context.get(ICodeContext);
        const executor = context.get(IActionExecutor);
        const boundOutput = context.get(IOutputChannel);
        return (subscription) => SubscriptionClient.create(ctx, executor, boundOutput, subscription);
    });

    traceBinding(output, 'IWebAppClientProvider');
    container.bind(IWebAppClientProvider).toFactory(context => {
        const ctx = context.get(ICodeContext);
        const executor = context.get(IActionExecutor);
        const boundOutput = context.get(IOutputChannel);
        return (subscription) => WebAppClient.create(ctx, executor, boundOutput, subscription);
    });

    return container;
}
