/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable, multiInject } from 'inversify';
import { IToolInstaller, type ToolInstaller } from '../../tools/ToolInstaller';
import { IToolService, validateAcquireToolRequest, type AcquireToolRequest, type AcquireToolResult } from '../../tools/ToolService';
import type { ManagedCommand } from '../ManagedCommand';

/**
 * Resolves or installs a tool, on behalf of either another extension (through
 * the `vscode-azure/acquireTool` command) or one of the extension's own install
 * commands (through a `userToolRequest()` prefix argument).
 *
 * Errors are rethrown so programmatic callers see the failure; the user sees
 * them through the usual managed-command error handling.
 */
@injectable()
export class AcquireTool implements ManagedCommand<AcquireToolResult> {
    public constructor(
        @inject(IToolService) private readonly tools: IToolService,
        @inject(IActionContext) private readonly context: IActionContext,
        @inject(IVsCode) private readonly code: IVsCode,
        @multiInject(IToolInstaller) private readonly installers: readonly ToolInstaller[],
    ) { }

    /** @inheritdoc */
    public async execute(input: unknown): Promise<AcquireToolResult> {
        this.context.errorHandling.rethrow = true;

        const { request } = validateAcquireToolRequest(input, this.installers);
        this.context.telemetry.properties.toolId = request.toolId;
        this.context.telemetry.properties.requestingExtensionId = request.requestingExtensionId;

        return request.showProgressNotification
            ? this.acquireWithNotification(request)
            : this.tools.acquire(request);
    }

    private async acquireWithNotification(request: AcquireToolRequest): Promise<AcquireToolResult> {
        return await this.code.window.withProgress({
            location: this.code.ProgressLocation.Notification,
            cancellable: true,
            title: this.code.l10n.t('Azure'),
        }, (progress, notificationCancellation) => this.tools.acquire({
            ...request,
            // A caller that supplied its own token owns cancellation; otherwise
            // the notification's Cancel button drives it.
            cancellationToken: request.cancellationToken ?? notificationCancellation,
            progress: message => {
                request.progress?.(message);
                progress.report({ message });
            },
        }));
    }
}
