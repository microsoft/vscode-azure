/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ICodeContext, PromptStep, showSmartQuickPick } from '@microsoft/vscode-azure-utils';
import type { AzdWizardContext } from './AzdWizardContext';

/**
 * Asks the user whether to run `azd provision` now.
 *
 * Only prompts in the Bootstrapped state of the `deploy` job
 * (`existingDefaultEnvName` is set). The other paths default
 * {@linkcode AzdWizardContext.provision provision} to `true` (seeded by the
 * command entry point) because the user already opted into a deploy-flavored
 * command and re-prompting would be noise.
 */
export class ConfirmProvisionStep<TContext extends AzdWizardContext> extends PromptStep<TContext> {
    public constructor(
        private readonly ctx: ICodeContext,
    ) {
        super();
    }

    public override shouldPrompt(context: Readonly<TContext>): boolean {
        return !!context.existingDefaultEnvName;
    }

    public async prompt(context: Readonly<TContext>): Promise<Partial<TContext>> {
        // shouldPrompt guarantees existingDefaultEnvName is set
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const envName = context.existingDefaultEnvName!;

        const items = [
            {
                label: this.ctx.code.l10n.t('Yes'),
                description: this.ctx.code.l10n.t('Provision now'),
                data: true,
            },
            {
                label: this.ctx.code.l10n.t('No'),
                description: this.ctx.code.l10n.t('Skip provisioning'),
                data: false,
            },
        ];

        const picked = await showSmartQuickPick(this.ctx, items, {
            placeHolder: this.ctx.code.l10n.t('Provision \'{0}\' now?', envName),
            showBack: true,
        });

        return { provision: picked.data } as Partial<TContext>;
    }
}
