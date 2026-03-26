/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ICodeContext, PromptStep, showSmartInputBox } from '@microsoft/vscode-azure-utils';
import type { CreateFunctionAppContext } from '../CreateFunctionAppContext';

/**
 * Prompts the user for an azd environment name. This name is used
 * by the Azure Developer CLI to isolate state and resources.
 */
export class InputEnvironmentNameStep extends PromptStep<CreateFunctionAppContext> {
    public constructor(
        private readonly ctx: ICodeContext,
    ) {
        super();
    }

    public async prompt(): Promise<Partial<CreateFunctionAppContext>> {
        const name = await showSmartInputBox(this.ctx, {
            prompt: this.ctx.code.l10n.t('Enter an environment name for azd'),
            placeHolder: 'dev',
            showBack: true,
            validateInput: (value) => {
                if (!value) {
                    return this.ctx.code.l10n.t('Environment name is required');
                }
                if (!/^[a-zA-Z0-9-]+$/.test(value)) {
                    return this.ctx.code.l10n.t('Only letters, numbers, and hyphens are allowed');
                }
                return undefined;
            },
        });

        return { environmentName: name };
    }
}
