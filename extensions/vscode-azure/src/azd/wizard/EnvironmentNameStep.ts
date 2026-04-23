/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ICodeContext, getWorkspaceFolder, PromptStep, showSmartInputBox } from '@microsoft/vscode-azure-utils';
import type { AzdWizardContext } from './AzdWizardContext';

/**
 * Prompts the user for an azd environment name. This name is used
 * by the Azure Developer CLI to isolate state and resources.
 */
export class EnvironmentNameStep<TContext extends AzdWizardContext> extends PromptStep<TContext> {
    public constructor(
        private readonly ctx: ICodeContext,
    ) {
        super();
    }

    public override shouldPrompt(context: Readonly<TContext>): boolean {
        return !context.environmentName;
    }

    public async prompt(): Promise<Partial<TContext>> {
        const defaultName = (await getWorkspaceFolder(this.ctx.code))?.name ?? 'dev';

        const name = await showSmartInputBox(this.ctx, {
            prompt: this.ctx.code.l10n.t('Enter an environment name for azd'),
            fallbackValue: defaultName,
            showBack: true,
            validateInput: (value) => {
                if (!value) {
                    return this.ctx.code.l10n.t('Environment name is required');
                } else if (!/^[a-zA-Z0-9-]+$/.test(value)) {
                    return this.ctx.code.l10n.t('Only letters, numbers, and hyphens are allowed');
                }
                return undefined;
            },
        });

        return { environmentName: name } as Partial<TContext>;
    }
}
