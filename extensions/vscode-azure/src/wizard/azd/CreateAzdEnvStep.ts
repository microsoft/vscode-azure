/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep } from '@microsoft/vscode-azure-utils';
import { execAzd } from '../../utils/azdUtils';
import type { AzdWizardContext } from './AzdWizardContext';

// TODO: Replace with AZD extension API when available
export class CreateAzdEnvStep<TContext extends AzdWizardContext> extends ExecuteStep<TContext> {
    public override shouldExecute(context: Readonly<TContext>): boolean {
        return !!context.iacFolder && !!context.environmentName && !!context.location?.name && !!context.subscription;
    }

    public async execute(context: TContext): Promise<void> {
        const args = [
            'env', 'new', context.environmentName!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
            '--location', context.location!.name!,  // eslint-disable-line @typescript-eslint/no-non-null-assertion
            '--subscription', context.subscription!.subscriptionId, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        ];

        await execAzd(args, context.iacFolder!.fsPath); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    }
}
