/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ICodeContext, PromptStep, showSmartQuickPick } from '@microsoft/vscode-azure-utils';
import type { CreateFunctionAppContext, SaveOrDeployChoice } from '../CreateFunctionAppContext';

/**
 * Asks the user what to do with the generated Bicep project:
 * save to workspace, deploy now, or both.
 */
export class OfferSaveStep extends PromptStep<CreateFunctionAppContext> {
    public constructor(
        private readonly ctx: ICodeContext,
    ) {
        super();
    }

    public async prompt(): Promise<Partial<CreateFunctionAppContext>> {
        const items: { label: string; description: string; data: SaveOrDeployChoice }[] = [
            {
                label: this.ctx.code.l10n.t('Save & Deploy'),
                description: this.ctx.code.l10n.t('Save the Bicep files to your workspace and deploy'),
                data: 'saveAndDeploy',
            },
            {
                label: this.ctx.code.l10n.t('Deploy Now'),
                description: this.ctx.code.l10n.t('Deploy immediately without saving'),
                data: 'deploy',
            },
            {
                label: this.ctx.code.l10n.t('Save Only'),
                description: this.ctx.code.l10n.t('Save to workspace for later review'),
                data: 'save',
            },
        ];

        const picked = await showSmartQuickPick(this.ctx, items, {
            placeHolder: this.ctx.code.l10n.t('What would you like to do with the generated template?'),
            showBack: true,
        });

        return { saveOrDeploy: picked.data };
    }
}
