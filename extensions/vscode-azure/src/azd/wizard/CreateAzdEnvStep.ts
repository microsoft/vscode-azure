/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzdService } from '../AzdService';
import type { AzdWizardContext } from './AzdWizardContext';

/**
 * Creates a new azd environment (`azd env new`) in
 * {@linkcode AzdWizardContext.iacFolder iacFolder} using the selected
 * subscription, location, and environment name.
 *
 * Skipped when {@linkcode AzdWizardContext.existingDefaultEnvName existingDefaultEnvName}
 * is set (Bootstrapped state) and re-validates against the actual `iacFolder`
 * at execute time -- if an environment with the chosen name already exists
 * there, this step is a no-op (no `envUpdate` fallback; the wizard never
 * mutates an existing user environment).
 */
@injectable()
export class CreateAzdEnvStep<TContext extends AzdWizardContext> extends ExecuteStep<TContext> {
    public constructor(
        @inject(IAzdService) private readonly azd: IAzdService,
    ) {
        super();
    }

    public override shouldExecute(context: Readonly<TContext>): boolean {
        return (
            !!context.iacFolder
            && !!context.environmentName
            && !!(context.hydratedLocationName ?? context.location?.name)
            && !!(context.hydratedSubscriptionId ?? context.subscription?.subscriptionId)
            && !context.existingDefaultEnvName
        );
    }

    public async execute(context: Readonly<TContext>): Promise<void> {
        /* eslint-disable @typescript-eslint/no-non-null-assertion */
        const name = context.environmentName!;
        const location = context.hydratedLocationName ?? context.location!.name!;
        const subscriptionId = context.hydratedSubscriptionId ?? context.subscription!.subscriptionId;
        const cwd = context.iacFolder!;
        /* eslint-enable @typescript-eslint/no-non-null-assertion */

        // `shouldExecute` already gates on
        // !existingDefaultEnvName, but the workspace could have changed
        // between hydration and now. Skip if an env with this name exists
        // rather than failing on `azd env new`.
        if (await this.azd.envExists(name, cwd)) {
            return;
        }

        await this.azd.envNew(name, location, subscriptionId, cwd);
    }
}
