/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ICodeContext, PromptStep, showSmartQuickPick } from '@microsoft/vscode-azure-utils';
import type { CreateFunctionAppContext } from '../CreateFunctionAppContext';

/**
 * Asks the user whether to save to workspace and/or deploy.
 * Sets `projectDir` to the workspace folder if saving, and
 * sets the `deploy` flag.
 */
export class OfferSaveStep extends PromptStep<CreateFunctionAppContext> {
    public constructor(
        private readonly ctx: ICodeContext,
    ) {
        super();
    }

    public async prompt(): Promise<Partial<CreateFunctionAppContext>> {
        const items = [
            {
                label: this.ctx.code.l10n.t('Save & Deploy'),
                description: this.ctx.code.l10n.t('Save files to workspace and deploy'),
                data: { save: true, deploy: true },
            },
            {
                label: this.ctx.code.l10n.t('Save Only'),
                description: this.ctx.code.l10n.t('Save to workspace for later review'),
                data: { save: true, deploy: false },
            },
            {
                label: this.ctx.code.l10n.t('Deploy Only'),
                description: this.ctx.code.l10n.t('Deploy from a temporary directory'),
                data: { save: false, deploy: true },
            },
        ];

        const picked = await showSmartQuickPick(this.ctx, items, {
            placeHolder: this.ctx.code.l10n.t('What would you like to do with the generated template?'),
            showBack: true,
        });

        const result: Partial<CreateFunctionAppContext> = { deploy: picked.data.deploy };

        if (picked.data.save) {
            const folders = this.ctx.code.workspace.workspaceFolders;
            if (folders && folders.length > 0) {
                result.projectDir = folders[0].uri.fsPath;
            } else {
                const picked2 = await this.ctx.code.window.showOpenDialog({
                    canSelectFolders: true,
                    canSelectFiles: false,
                    canSelectMany: false,
                    openLabel: this.ctx.code.l10n.t('Select folder'),
                });
                if (picked2 && picked2.length > 0) {
                    result.projectDir = picked2[0].fsPath;
                }
            }
        }

        return result;
    }
}
