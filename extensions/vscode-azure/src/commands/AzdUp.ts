/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import { IActionContext, ICodeContext, IOutputChannel, showSmartQuickPick, Wizard } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import { IAzdService } from '../azd/AzdService';
import { AzdDeployStep } from '../azd/wizard/AzdDeployStep';
import { AzdProvisionStep } from '../azd/wizard/AzdProvisionStep';
import type { AzdWizardContext } from '../azd/wizard/AzdWizardContext';
import { ShowEndpointUrlStep } from '../azd/wizard/ShowEndpointUrlStep';
import { IAzureSubscriptionProvider, IAzureViewDataTree } from '../services';
import { ArmDeploymentDataProvider } from '../tree/activity/ArmDeploymentDataProvider';
import { CodeDeploymentDataProvider } from '../tree/activity/CodeDeploymentDataProvider';
import type { ManagedCommand } from './ManagedCommand';

/**
 * Runs `azd provision` then `azd deploy` sequentially in visible
 * terminals, feeding the activity view with ARM deployment tracking
 * and code deployment progress.
 *
 * Accessible from the command palette (searches workspace for
 * `azure.yaml`) or by right-clicking an `azure.yaml` / `azure.yml`
 * file in the explorer.
 */
@injectable()
export class AzdUp implements ManagedCommand {
    public constructor(
        @inject(IActionContext) private readonly actionContext: IActionContext,
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IOutputChannel) private readonly output: IOutputChannel,
        @inject(IAzdService) private readonly azd: IAzdService,
        @inject(ArmDeploymentDataProvider) private readonly armProvider: ArmDeploymentDataProvider,
        @inject(CodeDeploymentDataProvider) private readonly codeProvider: CodeDeploymentDataProvider,
        @inject(IAzureSubscriptionProvider) private readonly subscriptionProvider: AzureSubscriptionProvider,
        @inject(IAzureViewDataTree) private readonly dataTree: IAzureViewDataTree,
    ) { }

    /** @inheritdoc */
    public async execute(fileUri?: vscode.Uri): Promise<void> {
        const iacFolder = await this.resolveCwd(fileUri);
        if (!iacFolder) {
            return;
        }

        const wizard = new Wizard<AzdWizardContext>(
            this.output,
            {
                iacFolder,
                provision: true,
                deploy: true,
            },
            [], // No prompt steps -- cwd is resolved above
            [
                new AzdProvisionStep(this.azd, this.output, this.armProvider, this.subscriptionProvider),
                new AzdDeployStep(this.actionContext, this.azd, this.output, this.codeProvider),
                new ShowEndpointUrlStep(this.ctx),
            ],
        );

        await wizard.run();

        this.dataTree.invalidateAll();
    }

    /**
     * Resolves the working directory for `azd`. When invoked from a
     * right-click on `azure.yaml`, the file URI is passed directly.
     * From the command palette, we search workspace folders.
     */
    private async resolveCwd(fileUri?: vscode.Uri): Promise<vscode.Uri | undefined> {
        if (fileUri) {
            // Right-click on a file -- use its parent directory
            return this.ctx.code.Uri.joinPath(fileUri, '..');
        }

        // Command palette -- search workspace folders for azure.yaml
        const workspaceFolders = this.ctx.code.workspace.workspaceFolders;
        if (!workspaceFolders?.length) {
            this.actionContext.errorHandling.suppressReportIssue = true;
            throw new Error(this.ctx.code.l10n.t('No workspace folder is open. Open a folder with an azure.yaml file.'));
        }

        const candidates: { label: string; uri: vscode.Uri }[] = [];
        for (const folder of workspaceFolders) {
            const found = await this.azd.findAzureYaml(folder.uri);
            if (found) {
                candidates.push({ label: folder.name, uri: folder.uri });
            }
        }

        if (candidates.length === 0) {
            this.actionContext.errorHandling.suppressReportIssue = true;
            throw new Error(this.ctx.code.l10n.t('No azure.yaml file found in the workspace.'));
        }

        if (candidates.length === 1) {
            return candidates[0].uri;
        }

        // Multiple workspace folders have azure.yaml -- let the user pick
        const picked = await showSmartQuickPick(this.ctx,
            candidates.map(c => ({ label: c.label, uri: c.uri })),
            { placeHolder: this.ctx.code.l10n.t('Select a project to provision and deploy') },
        );
        return picked.uri;
    }
}
