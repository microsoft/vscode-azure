/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStaticWebAppClientProvider, StaticWebAppClient } from '@microsoft/vscode-azure-azutils';
import { IActionExecutor, IExtensionContext, IOutputChannel, IProcessExecutor, IVsCode } from '@microsoft/vscode-azure-utils';
import { DeployStaticWebAppCommandId } from '../constants';
import { BrowseStaticWebApp } from '../commands/staticWebApps/BrowseStaticWebApp';
import { CreateStaticWebApp } from '../commands/staticWebApps/CreateStaticWebApp';
import { CreateSwaConfigFile } from '../commands/staticWebApps/CreateSwaConfigFile';
import { DeleteStaticWebAppEnvironment } from '../commands/staticWebApps/DeleteStaticWebAppEnvironment';
import { DeployStaticWebApp } from '../commands/staticWebApps/DeployStaticWebApp';
import { InstallOrUpdateSwaCli } from '../commands/staticWebApps/InstallOrUpdateSwaCli';
import { ShowFunctionsDocumentation, ShowStaticWebAppsDocumentation } from '../commands/staticWebApps/ShowDocumentation';
import { StaticWebAppCommandResolver } from '../commands/staticWebApps/StaticWebAppCommandResolver';
import { UninstallSwaCli } from '../commands/staticWebApps/UninstallSwaCli';
import { ViewStaticWebAppProperties } from '../commands/staticWebApps/ViewStaticWebAppProperties';
import { PwaChromeDebugType, SwaDebugConfigurationProvider, SwaDebugType } from '../debug/staticWebApps/SwaDebugConfigurationProvider';
import type { ProductRegistrar } from '../registration/ProductRegistrar';
import { pushDisposable } from '../services';
import { StaticWebAppSettingsAdapter } from '../settings/adapters/StaticWebAppSettingsAdapter';
import { GitRemoteService, IGitRemoteService } from '../staticWebApps/GitRemoteService';
import { StaticWebAppConfigFileName, SwaCliConfigFileName } from '../staticWebApps/SwaCliConfig';
import { ISwaCliService, SwaCliService } from '../staticWebApps/SwaCliService';
import { IProcessTerminator, ProcessTerminator, SwaTaskLifecycle } from '../tasks/staticWebApps/SwaTaskLifecycle';
import { SwaTaskProvider } from '../tasks/staticWebApps/SwaTaskProvider';
import { IStaticWebAppDataProvider, StaticWebAppDataProvider } from '../tree/resources/staticWebApps/StaticWebAppDataProvider';
import { StaticWebAppViewProvider } from '../tree/resources/staticWebApps/StaticWebAppViewProvider';

/** Contribute all Azure Static Web Apps services and UI integrations. */
export function registerStaticWebApps(registrar: ProductRegistrar): void {
    registrar.registerAzureClientProvider(IStaticWebAppClientProvider, (context, executor, credential, subscription) => {
        return StaticWebAppClient.create(context, executor, credential, subscription);
    });

    registrar.registerBinding(container => {
        container.bind(StaticWebAppCommandResolver).toSelf();
        container.bind(StaticWebAppSettingsAdapter).toSelf().inSingletonScope();
        container.bind(IGitRemoteService).to(GitRemoteService).inSingletonScope();
        container.bind(ISwaCliService).toDynamicValue(context => new SwaCliService(
            context.get(IVsCode),
            context.get(IProcessExecutor),
            context.get(IOutputChannel),
            context.get(IActionExecutor),
        )).inSingletonScope();
        container.bind(SwaTaskProvider).toSelf().inSingletonScope();
        container.bind(SwaDebugConfigurationProvider).toSelf().inSingletonScope();
        container.bind(IProcessTerminator).to(ProcessTerminator).inSingletonScope();
        container.bind(SwaTaskLifecycle).toSelf().inSingletonScope().onActivation(pushDisposable);
    });

    registrar.registerCommand('vscode-azure/staticWebApps/browse', BrowseStaticWebApp);
    registrar.registerCommand('vscode-azure/staticWebApps/createNew', CreateStaticWebApp, 'basic');
    registrar.registerCommand('vscode-azure/staticWebApps/createAdvanced', CreateStaticWebApp, 'advanced');
    registrar.registerCommand('vscode-azure/staticWebApps/deleteEnvironment', DeleteStaticWebAppEnvironment);
    registrar.registerCommand(DeployStaticWebAppCommandId, DeployStaticWebApp);
    registrar.registerCommand('vscode-azure/staticWebApps/createSwaConfigFile', CreateSwaConfigFile);
    registrar.registerCommand('vscode-azure/staticWebApps/showDocumentation', ShowStaticWebAppsDocumentation);
    registrar.registerCommand('vscode-azure/staticWebApps/showFunctionsDocumentation', ShowFunctionsDocumentation);
    registrar.registerCommand('vscode-azure/staticWebApps/viewProperties', ViewStaticWebAppProperties);
    registrar.registerCommand('vscode-azure/staticWebApps/installOrUpdateCli', InstallOrUpdateSwaCli);
    registrar.registerCommand('vscode-azure/staticWebApps/uninstallCli', UninstallSwaCli);

    registrar.registerResourceDataProvider([IStaticWebAppDataProvider, StaticWebAppDataProvider]);
    registrar.registerResourceViewProvider(StaticWebAppViewProvider);

    registrar.registerActivation(container => {
        const code = container.get(IVsCode);
        const extensionContext = container.get(IExtensionContext);
        const taskProvider = container.get(SwaTaskProvider);
        const debugProvider = container.get(SwaDebugConfigurationProvider);

        extensionContext.subscriptions.push(
            code.tasks.registerTaskProvider('shell', taskProvider),
            code.debug.registerDebugConfigurationProvider(PwaChromeDebugType, debugProvider),
            code.debug.registerDebugConfigurationProvider(
                SwaDebugType,
                debugProvider,
                code.DebugConfigurationProviderTriggerKind.Dynamic,
            ),
            code.debug.registerDebugConfigurationProvider(
                SwaDebugType,
                debugProvider,
                code.DebugConfigurationProviderTriggerKind.Initial,
            ),
        );
    });

    // Resolve the lifecycle eagerly so its task event subscriptions are active.
    registrar.registerActivation(container => {
        container.get(SwaTaskLifecycle);
    });

    registrar.registerActivation(container => {
        void container.get(IActionExecutor).callWithTelemetryAndErrorHandling(
            'staticWebApps.validateStaticWebAppsCliIsLatest',
            async context => {
                context.telemetry.isUserEvent = false;
                context.errorHandling.suppress = 'display';

                const hasProject = await hasStaticWebAppProject(container.get(IVsCode));
                context.telemetry.properties.hasStaticWebAppProject = String(hasProject);
                if (!hasProject) {
                    return;
                }

                await container.get(ISwaCliService).warnIfOutdated();
            },
        );
    });
}

/**
 * Whether any workspace folder holds a Static Web Apps project at its root.
 *
 * Two `stat` calls per folder, which is cheap enough to run on every
 * activation -- unlike the update check it gates, which spawns npm and queries
 * the registry, and which most users have no Static Web App to benefit from.
 *
 * Only folder roots are checked, deliberately: a walk is not worth paying for
 * to decide whether to show an optional version nudge.
 */
async function hasStaticWebAppProject(code: IVsCode): Promise<boolean> {
    for (const folder of code.workspace.workspaceFolders ?? []) {
        for (const name of [SwaCliConfigFileName, StaticWebAppConfigFileName]) {
            try {
                await code.workspace.fs.stat(code.Uri.joinPath(folder.uri, name));
                return true;
            } catch {
                // Absent, which is the common case and not an error here.
            }
        }
    }

    return false;
}
