/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep, type IVsCode } from '@microsoft/vscode-azure-utils';
import type { AzdWizardContext } from './AzdWizardContext';

/**
 * Deploys the generated project by invoking the Azure Developer CLI
 * extension's `azure-dev.provision` command on the project directory.
 */
export class AzdProvisionStep<TContext extends AzdWizardContext> extends ExecuteStep<TContext> {
    public constructor(
        private readonly code: IVsCode,
    ) {
        super();
    }

    public shouldExecute(context: Readonly<TContext>): boolean {
        return context.provision === true;
    }

    public async execute(context: TContext): Promise<void> {
        await this.code.commands.executeCommand(
            'azure-dev.commands.cli.provision',
            this.code.Uri.file(context.iacFolder!), // eslint-disable-line @typescript-eslint/no-non-null-assertion
        );
    }
}
