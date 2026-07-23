/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IExtensionContext, IOutputChannel, IVsCode, stringifyError } from '@microsoft/vscode-azure-utils';
import type { Container } from 'inversify';
import { SwaDebugConfigurationProvider, PwaChromeDebugType, SwaDebugType } from '../debug/staticWebApps/SwaDebugConfigurationProvider';
import { IStaticWebAppsGitHubService } from '../services/StaticWebAppsGitHubService';
import { SwaTaskLifecycle } from '../tasks/staticWebApps/SwaTaskLifecycle';
import { SwaTaskProvider } from '../tasks/staticWebApps/SwaTaskProvider';
import { GitHubActionLogContentProvider, GitHubActionLogScheme } from './GitHubActionLogContentProvider';
import { GitHubActionLogFoldingProvider } from './GitHubActionLogFoldingProvider';
import { ISwaCliService } from './SwaCliService';

/**
 * Registers Static Web Apps local task/debug/log providers and activation services.
 *
 * Every registration is owned by the extension context. Best-effort activation
 * checks use explicit rejection handlers so they cannot become unhandled promises.
 */
export function registerStaticWebAppLocalTools(container: Container): void {
    const code = container.get(IVsCode);
    const extensionContext = container.get(IExtensionContext);
    const output = container.get(IOutputChannel);
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

    if (!process.env.VSCODE_RUNNING_TESTS) {
        void container.get(ISwaCliService).warnIfOutdated().catch((error: unknown) => {
            output.warn(code.l10n.t(
                '[swa] CLI update check failed: {0}',
                stringifyError(error),
            ));
        });

        void container.get(IStaticWebAppsGitHubService).prepareAuthentication().catch(() => {
            output.warn(code.l10n.t('[swa] GitHub authentication prewarm failed.'));
        });
    }
}
