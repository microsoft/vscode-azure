/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeContext, PromptStep, showSmartQuickPick } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type { AzdWizardContext } from './AzdWizardContext';

/**
 * Asks the user whether to run `azd provision` now, *only* in the
 * Bootstrapped state of the `deploy` job (i.e. when an existing default azd
 * environment was found by {@linkcode HydrateAzdInfoStep}).
 *
 * The {@linkcode shouldPrompt} gate is `!!existingDefaultEnvName`, not
 * `provision === undefined`. The deploy command always seeds
 * {@linkcode AzdWizardContext.provision provision} to `true` so the no-prompt
 * paths (Fresh / Post-clone) actually provision; this step is the
 * *interruption* point that catches the one risky case where running
 * `azd provision` would re-touch an existing live deployment. If the user
 * picks "No", the seeded `true` gets overwritten with `false` and
 * {@linkcode AzdProvisionStep} skips.
 *
 * State summary:
 * - Fresh / Post-clone: no existing env -> step skipped, seeded `true`
 *   carries through, provision runs.
 * - Bootstrapped + Yes: existing env -> step prompts, re-affirms `true`,
 *   provision runs.
 * - Bootstrapped + No: existing env -> step prompts, sets `false`,
 *   provision skipped.
 */
@injectable()
export class ConfirmProvisionStep<TContext extends AzdWizardContext> extends PromptStep<TContext> {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
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
            placeHolder: this.ctx.code.l10n.t(
                'Provision \'{0}\' now? This updates the resources that have already been deployed.',
                envName,
            ),
            showBack: true,
        });

        return { provision: picked.data } as Partial<TContext>;
    }
}
