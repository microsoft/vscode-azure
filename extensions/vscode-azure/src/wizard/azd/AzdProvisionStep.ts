/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep, type IVsCode } from '@microsoft/vscode-azure-utils';
import { findAzureYaml } from '../../utils/azdUtils';
import type { AzdWizardContext } from './AzdWizardContext';

/**
 * Deploys the generated project by invoking the Azure Developer CLI
 * extension's `azure-dev.commands.cli.provision` command on the project directory.
 */
export class AzdProvisionStep<TContext extends AzdWizardContext> extends ExecuteStep<TContext> {
    public constructor(
        private readonly code: IVsCode,
    ) {
        super();
    }

    public override shouldExecute(context: Readonly<TContext>): boolean {
        return context.provision === true && !!context.iacFolder;
    }

    public async execute(context: TContext): Promise<void> {
        const azureYamlUri = await findAzureYaml(this.code, context.iacFolder!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        if (!azureYamlUri) {
            throw new Error('Could not find azure.yaml or azure.yml in the project directory.');
        }

        await this.code.commands.executeCommand(
            'azure-dev.commands.cli.provision',
            azureYamlUri,
        );
    }
}
