/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import { IActionContext, ICodeContext, IOutputChannel, Wizard } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import { IAzdService } from '../azd/AzdService';
import { AzdDeployStep } from '../azd/wizard/AzdDeployStep';
import { AzdProvisionStep } from '../azd/wizard/AzdProvisionStep';
import type { AzdWizardContext } from '../azd/wizard/AzdWizardContext';
import { SelectIacFolderStep } from '../azd/wizard/SelectIacFolderStep';
import { ShowEndpointUrlStep } from '../azd/wizard/ShowEndpointUrlStep';
import { IAzureSubscriptionProvider, IAzureViewDataTree, ITempDirManager } from '../services';
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
        @inject(ITempDirManager) private readonly tempManager: ITempDirManager,
    ) { }

    /** @inheritdoc */
    public async execute(fileUri?: vscode.Uri): Promise<void> {
        // Pre-seed iacFolder when invoked from a right-click on azure.yaml
        const iacFolder = fileUri ? this.ctx.code.Uri.joinPath(fileUri, '..') : undefined;

        const wizard = new Wizard<AzdWizardContext>(
            this.output,
            {
                iacFolder,
                provision: true,
                deploy: true,
            },
            [
                new SelectIacFolderStep(this.actionContext, this.ctx, this.tempManager, this.azd),
            ],
            [
                new AzdProvisionStep(this.ctx, this.azd, this.output, this.armProvider, this.subscriptionProvider, this.tempManager),
                new AzdDeployStep(this.actionContext, this.azd, this.codeProvider),
                new ShowEndpointUrlStep(this.ctx, this.azd),
            ],
        );

        await wizard.run();

        this.dataTree.invalidateAll();
    }
}
