/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep } from '@microsoft/vscode-azure-utils';
import type { IAzdService } from '../AzdService';
import type { AzdWizardContext } from './AzdWizardContext';

// TODO: future: Replace with AZD extension API when available
/**
 * Creates a new azd environment (`azd env new`) in {@linkcode AzdWizardContext.iacFolder}
 * using the selected subscription, location, and environment name. If
 * {@linkcode AzdWizardContext.envAlreadyExists} is `true` (i.e.
 * {@linkcode HydrateAzdInfoStep} already found an environment with that name),
 * updates the existing environment's `AZURE_LOCATION` /
 * `AZURE_SUBSCRIPTION_ID` instead so `azd env new` doesn't fail.
 */
export class CreateAzdEnvStep<TContext extends AzdWizardContext> extends ExecuteStep<TContext> {
    public constructor(
        private readonly azd: IAzdService,
    ) {
        super();
    }

    public override shouldExecute(context: Readonly<TContext>): boolean {
        return !!context.iacFolder && !!context.environmentName && !!context.location?.name && !!context.subscription;
    }

    public async execute(context: TContext): Promise<void> {
        /* eslint-disable @typescript-eslint/no-non-null-assertion */
        const name = context.environmentName!;
        const location = context.location!.name!;
        const subscriptionId = context.subscription!.subscriptionId;
        const cwd = context.iacFolder!;
        /* eslint-enable @typescript-eslint/no-non-null-assertion */

        if (context.envAlreadyExists) {
            await this.azd.envUpdate(name, location, subscriptionId, cwd);
        } else {
            await this.azd.envNew(name, location, subscriptionId, cwd);
        }
    }
}
