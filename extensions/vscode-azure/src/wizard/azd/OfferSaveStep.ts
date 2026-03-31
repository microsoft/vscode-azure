/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ICodeContext, PromptStep, showSmartQuickPick } from '@microsoft/vscode-azure-utils';
import type { AzdWizardContext } from './AzdWizardContext';
import type { TempProjectManager } from './TempProjectManager';

/**
 * Asks the user whether to save to workspace and/or deploy.
 * Sets `projectDir` to the workspace folder if saving, and
 * sets the `deploy` flag.
 */
export class OfferSaveStep<TContext extends AzdWizardContext> extends PromptStep<TContext> {
    public constructor(
        private readonly ctx: ICodeContext,
        private readonly tempProjectManager: TempProjectManager
    ) {
        super();
    }

    public async prompt(): Promise<Partial<TContext>> {
        const items = [
            {
                label: this.ctx.code.l10n.t('Save & Deploy'),
                description: this.ctx.code.l10n.t('Save files to workspace and deploy'),
                data: { save: true, provision: true },
            },
            {
                label: this.ctx.code.l10n.t('Save Only'),
                description: this.ctx.code.l10n.t('Save to workspace for later review'),
                data: { save: true, provision: false },
            },
            {
                label: this.ctx.code.l10n.t('Deploy Only'),
                description: this.ctx.code.l10n.t('Deploy from a temporary directory'),
                data: { save: false, provision: true },
            },
        ];

        const picked = await showSmartQuickPick(this.ctx, items, {
            placeHolder: this.ctx.code.l10n.t('What would you like to do with the generated template?'),
            showBack: true,
        });

        let iacFolder: string;
        if (picked.data.save) {
            const folders = this.ctx.code.workspace.workspaceFolders;
            if (folders?.length === 1) {
                iacFolder = folders[0].uri.fsPath;
            } else {
                throw new Error('unimpl'); // TODO
            }
        } else {
            iacFolder = await this.tempProjectManager.createProjectDir();
        }

        return {
            provision: picked.data.provision,
            iacFolder
        } as Partial<TContext>;
    }
}
