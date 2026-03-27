/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ICodeContext, PromptStep, showSmartInputBox } from '@microsoft/vscode-azure-utils';
import type { CreateFunctionAppContext } from '../CreateFunctionAppContext';

/**
 * Prompts the user for a Function App name.
 */
export class InputFunctionAppNameStep extends PromptStep<CreateFunctionAppContext> {
    public constructor(
        private readonly ctx: ICodeContext,
    ) {
        super();
    }

    public async prompt(context: Readonly<CreateFunctionAppContext>): Promise<Partial<CreateFunctionAppContext>> {
        const defaultName = context.environmentName ? `func-${context.environmentName}` : undefined;

        const name = await showSmartInputBox(this.ctx, {
            prompt: this.ctx.code.l10n.t('Enter a globally unique Function App name'),
            value: defaultName,
            placeHolder: 'my-function-app',
            showBack: true,
            validateInput: (value) => {
                if (!value) {
                    return this.ctx.code.l10n.t('Function App name is required');
                }
                if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(value)) {
                    return this.ctx.code.l10n.t('Name must start with a letter or number and contain only letters, numbers, and hyphens');
                }
                if (value.length < 2 || value.length > 60) {
                    return this.ctx.code.l10n.t('Name must be between 2 and 60 characters');
                }
                return undefined;
            },
        });

        return { functionAppName: name };
    }
}
