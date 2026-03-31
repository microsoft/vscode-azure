/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ICodeContext, PromptStep, showSmartInputBox } from '@microsoft/vscode-azure-utils';
import type { AzdWizardContext } from './AzdWizardContext';

/**
 * Prompts the user for an app name.
 */
export class AppNameStep<TContext extends AzdWizardContext> extends PromptStep<TContext> {
    public constructor(
        // TODO: parameters for validation rules?
        private readonly ctx: ICodeContext,
    ) {
        super();
    }

    public shouldPrompt(context: Readonly<TContext>): boolean {
        return !context.appName;
    }

    public async prompt(context: Readonly<TContext>): Promise<Partial<TContext>> {
        const defaultName = context.environmentName ? `app-${context.environmentName}` : undefined;

        const appName = await showSmartInputBox(this.ctx, {
            prompt: this.ctx.code.l10n.t('Enter an app name'),
            value: defaultName,
            placeHolder: 'my-app',
            showBack: true,
            validateInput: (value) => {
                if (!value) {
                    return this.ctx.code.l10n.t('App name is required');
                }
                // TODO: enforce AZD app name rules
                return undefined;
            },
        });

        return { appName } as Partial<TContext>;
    }
}
