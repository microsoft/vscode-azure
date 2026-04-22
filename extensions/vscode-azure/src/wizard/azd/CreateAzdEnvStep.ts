/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep } from '@microsoft/vscode-azure-utils';
import type { IAzdService } from '../../utils/AzdService';
import type { AzdWizardContext } from './AzdWizardContext';

// TODO: future: Replace with AZD extension API when available
/**
 * Creates a new azd environment (`azd env new`) in {@linkcode AzdWizardContext.iacFolder}
 * using the selected subscription, location, and environment name.
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
        await this.azd.envNew(
            context.environmentName!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
            context.location!.name!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
            context.subscription!.subscriptionId, // eslint-disable-line @typescript-eslint/no-non-null-assertion
            context.iacFolder!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        );
    }
}
