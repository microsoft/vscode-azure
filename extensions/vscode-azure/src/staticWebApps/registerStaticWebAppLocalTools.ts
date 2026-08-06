/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionExecutor, IExtensionContext, IVsCode } from '@microsoft/vscode-azure-utils';
import type { Container } from 'inversify';
import { SwaDebugConfigurationProvider, PwaChromeDebugType, SwaDebugType } from '../debug/staticWebApps/SwaDebugConfigurationProvider';
import { SwaTaskLifecycle } from '../tasks/staticWebApps/SwaTaskLifecycle';
import { SwaTaskProvider } from '../tasks/staticWebApps/SwaTaskProvider';
import { ISwaCliService } from './SwaCliService';

/**
 * Registers Static Web Apps local task/debug providers and activation services.
 *
 * Every registration is owned by the extension context. Best-effort activation
 * checks use explicit rejection handlers so they cannot become unhandled promises.
 */
export function registerStaticWebAppLocalTools(container: Container): void {
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

    // Resolve the singleton so its event subscriptions are active.
    container.get(SwaTaskLifecycle);

    if (!process.env.VSCODE_RUNNING_TESTS) {
        void container.get(IActionExecutor).callWithTelemetryAndErrorHandling(
            'staticWebApps.validateStaticWebAppsCliIsLatest',
            async context => {
                context.telemetry.isUserEvent = false;
                context.errorHandling.suppress = 'display';
                await container.get(ISwaCliService).warnIfOutdated();
            },
        );
    }
}
