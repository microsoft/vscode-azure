/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ToolAcquisitionError } from '@microsoft/vscode-azure-azutils';
import { IActionContext, IExtensionContext, IVsCode, showMessage } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { MinAzdVersion } from '../../azd/AzdService';
import type { ManagedCommand } from '../ManagedCommand';
import { AcquireToolCommandId } from './AcquireTool';

/**
 * Installs the Azure Developer CLI (`azd`) through the public tool acquisition
 * command with user-visible progress.
 */
@injectable()
export class InstallAzd implements ManagedCommand {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IExtensionContext) private readonly extensionContext: IExtensionContext,
        @inject(IActionContext) private readonly context: IActionContext,
    ) { }

    /** @inheritdoc */
    public async execute(): Promise<void> {
        try {
            await this.code.commands.executeCommand(AcquireToolCommandId, {
                toolId: 'azd',
                requestingExtensionId: this.extensionContext.extension.id,
                versionRange: `>=${MinAzdVersion}`,
                progress: {
                    showNotification: true,
                    focusInstallTask: true,
                },
            });
        } catch (error) {
            if (!(error instanceof ToolAcquisitionError)) {
                throw error;
            }

            this.context.errorHandling.suppress = 'display';
            this.context.errorHandling.rethrow = true;
            const learnMore = error.learnMoreUrl ? this.code.l10n.t('Learn More') : undefined;
            const choice = await showMessage(
                this.code,
                this.getErrorMessage(error),
                { severity: 'error' },
                ...(learnMore ? [learnMore] : []),
            );
            if (choice === learnMore && error.learnMoreUrl) {
                await this.code.env.openExternal(this.code.Uri.parse(error.learnMoreUrl));
            }
            throw error;
        }
    }

    private getErrorMessage(error: ToolAcquisitionError): string {
        switch (error.code) {
            case 'signatureVerificationUnavailable':
                return this.code.l10n.t('Azure Developer CLI could not be installed because no verified installation method is available.');
            case 'versionNotSatisfied':
                return this.code.l10n.t('The installed Azure Developer CLI does not meet the required version.');
            case 'unsupportedArchitecture':
            case 'unsupportedPlatform':
                return this.code.l10n.t('Azure Developer CLI is not supported on this system.');
            case 'executableNotFound':
            case 'installationFailed':
            case 'postInstallVerificationFailed':
                return this.code.l10n.t('Azure Developer CLI could not be installed. See the Azure output channel for details.');
            case 'invalidRequest':
                return this.code.l10n.t('The Azure Developer CLI installation request is invalid.');
        }
    }
}
