/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ICodeContext, PromptStep, QuickPickItemWithData, showSmartQuickPick } from '@microsoft/vscode-azure-utils';
import type { CreateFunctionAppContext, FunctionAppHostingPlan } from '../CreateFunctionAppContext';

/**
 * Prompts the user to pick a hosting plan.
 */
export class PickHostingPlanStep extends PromptStep<CreateFunctionAppContext> {
    public constructor(
        private readonly ctx: ICodeContext,
    ) {
        super();
    }

    public shouldPrompt(context: Readonly<CreateFunctionAppContext>): boolean {
        return !context.hostingPlan;
    }

    public async prompt(): Promise<Partial<CreateFunctionAppContext>> {
        const items: QuickPickItemWithData<FunctionAppHostingPlan>[] = [
            { label: this.ctx.code.l10n.t('Flex Consumption'), description: this.ctx.code.l10n.t('Modern serverless, auto-scale'), data: 'FlexConsumption' },
            { label: this.ctx.code.l10n.t('Premium'), description: this.ctx.code.l10n.t('Elastic Premium, pre-warmed instances'), data: 'Premium' },
            { label: this.ctx.code.l10n.t('App Service Plan'), description: this.ctx.code.l10n.t('Dedicated plan, predictable pricing'), data: 'AppServicePlan' },
        ];

        const picked = await showSmartQuickPick(this.ctx, items, {
            placeHolder: this.ctx.code.l10n.t('Select a hosting plan'),
            showBack: true,
        });

        return { hostingPlan: picked.data };
    }
}
