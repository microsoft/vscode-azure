/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeContext, PromptStep, type QuickPickItemWithData, showSmartQuickPick } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type { AppServicePlanSku, CreateFunctionAppContext } from '../CreateFunctionAppContext';

/**
 * Prompts the user to pick a hosting plan.
 */
@injectable()
export class PickHostingPlanStep extends PromptStep<CreateFunctionAppContext> {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
    ) {
        super();
    }

    public override shouldPrompt(context: Readonly<CreateFunctionAppContext>): boolean {
        return !context.appServicePlanSkuName && !context.hasInfra;
    }

    public async prompt(): Promise<Partial<CreateFunctionAppContext>> {
        const items: QuickPickItemWithData<AppServicePlanSku>[] = [
            { label: this.ctx.code.l10n.t('Flex Consumption'), description: this.ctx.code.l10n.t('Modern serverless, auto-scale'), data: 'FC1' },
            { label: this.ctx.code.l10n.t('Premium'), description: this.ctx.code.l10n.t('Elastic Premium, pre-warmed instances'), data: 'EP1' },
            { label: this.ctx.code.l10n.t('App Service Plan'), description: this.ctx.code.l10n.t('Dedicated plan, predictable pricing'), data: 'S1' },
        ];

        const picked = await showSmartQuickPick(this.ctx, items, {
            placeHolder: this.ctx.code.l10n.t('Select a hosting plan'),
            showBack: true,
        });

        return { appServicePlanSkuName: picked.data };
    }
}
