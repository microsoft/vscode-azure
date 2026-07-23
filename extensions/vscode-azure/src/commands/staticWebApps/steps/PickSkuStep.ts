/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeContext, PromptStep, showSmartQuickPick, type QuickPickItemWithData } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type { CreateStaticWebAppContext, StaticWebAppSkuName } from '../CreateStaticWebAppContext';

/** Prompts advanced creation for a Free or Standard Static Web Apps plan. */
@injectable()
export class PickSkuStep extends PromptStep<CreateStaticWebAppContext> {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
    ) {
        super();
    }

    public override shouldPrompt(context: Readonly<CreateStaticWebAppContext>): boolean {
        return !context.hasInfra && !context.staticWebAppSkuName;
    }

    public async prompt(): Promise<Partial<CreateStaticWebAppContext>> {
        const items: QuickPickItemWithData<StaticWebAppSkuName>[] = [
            {
                label: this.ctx.code.l10n.t('Free'),
                description: this.ctx.code.l10n.t('Free SSL, 2 Custom Domains'),
                data: 'Free',
            },
            {
                label: this.ctx.code.l10n.t('Standard'),
                description: this.ctx.code.l10n.t('Free SSL, 5 Custom Domains, Custom Authentication, SLA'),
                data: 'Standard',
            },
        ];
        const selected = await showSmartQuickPick(this.ctx, items, {
            placeHolder: this.ctx.code.l10n.t('Select a pricing option'),
            showBack: true,
        });
        return { staticWebAppSkuName: selected.data };
    }
}
