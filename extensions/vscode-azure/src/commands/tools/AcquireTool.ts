/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AcquireToolCommandId,
    IToolAcquisitionService,
    validateToolAcquisitionRequest,
    type ToolAcquisitionProgress,
    type ToolAcquisitionRequest,
    type ToolAcquisitionResult,
} from '@microsoft/vscode-azure-azutils';
import { IActionContext, IOutputChannel, IVsCode, toAbortSignal } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import type { ManagedCommand } from '../ManagedCommand';

export { AcquireToolCommandId };

/**
 * Adapts the neutral tool acquisition service to the VS Code command API.
 *
 * Programmatic calls are silent by default and reject on failure. Callers may
 * request a cancellable notification through {@linkcode ToolAcquisitionRequest.progress}.
 */
@injectable()
export class AcquireTool implements ManagedCommand<ToolAcquisitionResult> {
    public constructor(
        @inject(IToolAcquisitionService) private readonly acquisition: IToolAcquisitionService,
        @inject(IActionContext) private readonly context: IActionContext,
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IOutputChannel) private readonly output: IOutputChannel,
    ) {
    }

    /** @inheritdoc */
    public async execute(input: unknown): Promise<ToolAcquisitionResult> {
        this.context.errorHandling.rethrow = true;
        this.context.errorHandling.suppress = 'display';

        const request = validateToolAcquisitionRequest(input);
        this.context.telemetry.properties.toolId = request.toolId;
        this.context.telemetry.properties.requestingExtensionId = request.requestingExtensionId;
        this.context.telemetry.properties.requestedArchitecture = request.architecture ?? process.arch;
        this.context.telemetry.properties.signaturePolicy = String(request.requireSignature);

        try {
            const result = request.progress?.showNotification
                ? await this.withProgress(request)
                : await this.acquisition.acquire(this.withReporter(request));
            this.context.telemetry.properties.acquisitionMethod = result.method;
            this.context.telemetry.properties.installed = String(result.installed);
            this.context.telemetry.properties.resolvedVersion = result.version;
            return result;
        } catch (error) {
            if (error instanceof Error) {
                this.context.telemetry.properties.acquisitionError = error.name;
            }
            throw error;
        }
    }

    private async withProgress(request: ToolAcquisitionRequest): Promise<ToolAcquisitionResult> {
        return this.code.window.withProgress({
            location: this.code.ProgressLocation.Notification,
            title: this.code.l10n.t('Installing Azure Developer CLI'),
            cancellable: true,
        }, async (progress, cancellationToken) => {
            const requestCancellation = toAbortSignal(request.cancellationToken);
            const notificationCancellation = toAbortSignal(cancellationToken);
            try {
                const signals = [requestCancellation.signal, notificationCancellation.signal]
                    .filter((signal): signal is AbortSignal => signal !== undefined);
                const combinedCancellation = signals.length === 1 ? signals[0] : AbortSignal.any(signals);
                return await this.acquisition.acquire(this.withReporter(request, progress, combinedCancellation));
            } finally {
                requestCancellation.disposable.dispose();
                notificationCancellation.disposable.dispose();
            }
        });
    }

    private withReporter(
        request: ToolAcquisitionRequest,
        progress?: vscode.Progress<{ message?: string }>,
        cancellationToken = request.cancellationToken,
    ): ToolAcquisitionRequest {
        return {
            ...request,
            cancellationToken,
            progress: {
                ...request.progress,
                report: event => {
                    request.progress?.report?.(event);
                    if (event.warning && event.message) {
                        this.output.warn(event.message);
                    }
                    progress?.report({ message: this.getProgressMessage(event) });
                },
            },
        };
    }

    private getProgressMessage(progress: ToolAcquisitionProgress): string {
        switch (progress.phase) {
            case 'resolve':
                return this.code.l10n.t('Looking for Azure Developer CLI...');
            case 'verify':
                return this.code.l10n.t('Verifying Azure Developer CLI...');
            case 'download':
                return this.code.l10n.t('Downloading Azure Developer CLI...');
            case 'install':
                return this.code.l10n.t('Installing Azure Developer CLI...');
        }
    }
}
