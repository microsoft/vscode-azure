/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep } from '@microsoft/vscode-azure-utils';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { AzdWizardContext } from './AzdWizardContext';

const execFileAsync = promisify(execFile);

// TODO: Replace with AZD extension API when available
export class CreateAzdEnvStep<TContext extends AzdWizardContext> extends ExecuteStep<TContext> {
    public async execute(context: TContext): Promise<void> {
        const args = [
            'env', 'new', context.environmentName!,  // eslint-disable-line @typescript-eslint/no-non-null-assertion
            '--location', context.location!.name!,    // eslint-disable-line @typescript-eslint/no-non-null-assertion
            '--subscription', context.subscription!.subscriptionId, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        ];

        await execFileAsync('azd', args, { cwd: context.iacFolder });
    }
}
