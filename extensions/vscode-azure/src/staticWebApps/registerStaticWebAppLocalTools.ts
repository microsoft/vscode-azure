/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionExecutor, IExtensionContext, IVsCode } from '@microsoft/vscode-azure-utils';
import type { Container } from 'inversify';
import { SwaDebugConfigurationProvider, PwaChromeDebugType, SwaDebugType } from '../debug/staticWebApps/SwaDebugConfigurationProvider';
import { SwaTaskLifecycle } from '../tasks/staticWebApps/SwaTaskLifecycle';
import { SwaTaskProvider } from '../tasks/staticWebApps/SwaTaskProvider';
import { GitHubActionLogContentProvider, GitHubActionLogScheme } from './GitHubActionLogContentProvider';
import { GitHubActionLogFoldingProvider } from './GitHubActionLogFoldingProvider';
import { StaticWebAppConfigFileName, SwaCliConfigFileName } from './SwaCliConfig';
import { ISwaCliService } from './SwaCliService';

/**
 * Registers Static Web Apps local task/debug/log providers and activation services.
 *
 * Every registration is owned by the extension context. The one best-effort
 * activation check is gated on the workspace actually holding a Static Web Apps
 * project, so users without one pay nothing for it.
 */
export function registerStaticWebAppLocalTools(container: Container): void {
    const code = container.get(IVsCode);
    const extensionContext = container.get(IExtensionContext);
    const taskProvider = container.get(SwaTaskProvider);
    const debugProvider = container.get(SwaDebugConfigurationProvider);
    const contentProvider = container.get(GitHubActionLogContentProvider);

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
        code.workspace.registerTextDocumentContentProvider(
            GitHubActionLogScheme,
            contentProvider,
        ),
        code.languages.registerFoldingRangeProvider(
            { scheme: GitHubActionLogScheme },
            new GitHubActionLogFoldingProvider(contentProvider),
        ),
    );

    // Resolve the singleton so its event subscriptions are active.
    container.get(SwaTaskLifecycle);

    void container.get(IActionExecutor).callWithTelemetryAndErrorHandling(
        'staticWebApps.validateStaticWebAppsCliIsLatest',
        async context => {
            context.telemetry.isUserEvent = false;
            context.errorHandling.suppress = 'display';

            const hasProject = await hasStaticWebAppProject(code);
            context.telemetry.properties.hasStaticWebAppProject = String(hasProject);
            if (!hasProject) {
                return;
            }

            await container.get(ISwaCliService).warnIfOutdated();
        },
    );
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
