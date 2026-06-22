/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, ICodeContext, IOutputChannel, Wizard } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import { IAzdService } from '../azd/AzdService';
import { ITempDirManager } from '../azd/TempDirManager';
import { AzdDownStep } from '../azd/wizard/AzdDownStep';
import type { AzdWizardContext } from '../azd/wizard/AzdWizardContext';
import { SelectIacFolderStep } from '../azd/wizard/SelectIacFolderStep';
import { IAzureViewDataTree } from '../services';
import type { ManagedCommand } from './ManagedCommand';

/**
 * Runs `azd down --force --purge` in a visible terminal, deleting all
 * resources provisioned for the project's default azd environment.
 *
 * Prompts for explicit confirmation before doing anything, since the
 * operation is destructive and irreversible.
 *
 * Accessible from the command palette (searches the workspace for
 * `azure.yaml` or `azure.yml`) or by right-clicking an `azure.yaml`
 * / `azure.yml` file in the explorer.
 */
@injectable()
export class AzdDown implements ManagedCommand {
    public constructor(
        @inject(IActionContext) private readonly actionContext: IActionContext,
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IOutputChannel) private readonly output: IOutputChannel,
        @inject(IAzdService) private readonly azd: IAzdService,
        @inject(IAzureViewDataTree) private readonly dataTree: IAzureViewDataTree,
        @inject(ITempDirManager) private readonly tempManager: ITempDirManager,
    ) { }

    /** @inheritdoc */
    public async execute(fileUri?: vscode.Uri): Promise<void> {
        // Pre-seed iacFolder when invoked from a right-click on azure.yaml
        const iacFolder = fileUri ? this.ctx.code.Uri.joinPath(fileUri, '..') : undefined;

        // Destructive, irreversible operation -- require explicit confirmation
        const deleteLabel = this.ctx.code.l10n.t('Delete');
        const confirmation = await this.ctx.code.window.showWarningMessage(
            this.ctx.code.l10n.t('Are you sure you want to delete all resources provisioned for this project\'s default environment? This cannot be undone.'),
            { modal: true },
            deleteLabel,
        );
        if (confirmation !== deleteLabel) {
            return;
        }

        const wizard = new Wizard<AzdWizardContext>(
            this.output,
            {
                iacFolder,
            },
            [
                new SelectIacFolderStep(this.actionContext, this.ctx, this.tempManager, this.azd),
            ],
            [
                new AzdDownStep(this.azd),
            ],
        );

        await wizard.run();

        this.dataTree.invalidateAll();
    }
}
