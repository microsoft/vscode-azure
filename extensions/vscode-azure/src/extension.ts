/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    setUpAzureSdkLogging,
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
import { ITempDirManager, TempDirManager } from './azd/TempDirManager';
import { createGenerateBicepStepFactory, IGenerateBicepStepFactory } from './azd/wizard/GenerateBicepStep';
import { registerCommands } from './commands/registerCommands';
import { registerProducts } from './products/registerProducts';
import { ProductRegistrar } from './registration/ProductRegistrar';
import { pushDisposable } from './services';
import { registerTrees } from './tree/registerTrees';
import { IWorkspaceIndexService, WorkspaceIndexService } from './utils/workspaceIndex/WorkspaceIndexService';

/**
 * Public API surface returned from {@linkcode activateInternal} (and thus from
 * the extension's `activate`) when `ENABLE_LONG_RUNNING_TESTS=1`. Exposes the root DI container so
 * E2E tests can resolve services such as {@linkcode IAzdService} for setup and
 * result verification, while still driving the real operations under test
 * through the extension's registered VS Code commands.
 *
 * Never returned during normal or production activation.
 */
export interface E2EExtensionApi {
    readonly container: Container;
}

/**
 * Entry point called by the generated extension `activate` function.
 *
 * Builds the DI container, optionally applies overrides to it via
 * {@linkcode applyOverrides}, then registers commands and tree views under a
 * telemetry-wrapped `activate` event.
 *
 * @param extensionContext - The VS Code extension context.
 * @param perfStats - Timestamps used to report activation duration telemetry.
 * @param applyOverrides - Optional callback to mutate the container after it is
 *   built but before activation (used by the "Run (Mock Data)" debug entry
 *   point to rebind services with mock implementations).
 * @returns When `ENABLE_LONG_RUNNING_TESTS=1`, an {@linkcode E2EExtensionApi} exposing the DI
 *   container so E2E tests can resolve services; otherwise `undefined`.
 */
export async function activateInternal(
    extensionContext: vscode.ExtensionContext,
    perfStats: { loadStartTime: number, loadEndTime: number },
    applyOverrides?: (container: Container) => void,
): Promise<E2EExtensionApi | undefined> {
    const products = new ProductRegistrar();
    registerProducts(products);
    const container = setUpContainer(extensionContext, products);

    applyOverrides?.(container);

    await container.get(IActionExecutor).callWithTelemetryAndErrorHandling('activate', activateContext => {
        activateContext.telemetry.measurements.loadTimeMs = perfStats.loadEndTime - perfStats.loadStartTime;
        activateContext.telemetry.isUserEvent = false;

        registerCommands(container, products.getCommands());
        registerTrees(container, products);
        products.activate(container);
    });

    // Expose the DI container to E2E tests so they can resolve services (e.g.
    // IAzdService) for setup and result verification. Gated on
    // ENABLE_LONG_RUNNING_TESTS so the container is never handed out during
    // normal or production activation.
    if (process.env.ENABLE_LONG_RUNNING_TESTS === '1') {
        return { container };
    }

    return undefined;
}

/** Entry point called by the generated extension `deactivate` function. */
export function deactivateInternal(_extensionContext: IExtensionContext): Promise<void> {
    return Promise.resolve();
}

/**
 * Builds the root inversify container with all extension-level bindings.
 * Disposable services are registered with {@linkcode pushDisposable} so they
 * are torn down with the extension context.
 */
function setUpContainer(extensionContext: IExtensionContext, products: ProductRegistrar): Container {
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

    container.bind(ITempDirManager).to(TempDirManager).inSingletonScope().onActivation(pushDisposable);

    container.bind(IProcessExecutor).toDynamicValue(context => {
        return new ProcessExecutor(context.get(IVsCode));
    }).inSingletonScope().onActivation(pushDisposable);

    container.bind(IWorkspaceIndexService).to(WorkspaceIndexService).inSingletonScope().onActivation(pushDisposable);

    container.bind(IAzdAuthServer).to(AzdAuthServer).inSingletonScope().onActivation(pushDisposable);
    container.bind(IAzdService).to(AzdService).inSingletonScope().onActivation(pushDisposable);

    container.bind(IGenerateBicepStepFactory).toFactory(context => createGenerateBicepStepFactory(context.get(ICodeContext)));

    products.applyBindings(container);

    return container;
}
