/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep } from '@microsoft/vscode-azure-utils';
import type { IAzdService } from '../../utils/AzdService';
import type { AzdWizardContext } from './AzdWizardContext';

/**
 * Deploys the generated project by running `azd provision` as a
 * foreground VS Code task in the project directory.
 */
export class AzdProvisionStep<TContext extends AzdWizardContext> extends ExecuteStep<TContext> {
    public constructor(
        private readonly azd: IAzdService,
    ) {
        super();
    }

    public override shouldExecute(context: Readonly<TContext>): boolean {
        return context.provision === true && !!context.iacFolder;
    }

    public async execute(context: TContext): Promise<void> {
        const azureYamlUri = await this.azd.findAzureYaml(context.iacFolder!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        if (!azureYamlUri) {
            throw new Error('Could not find azure.yaml or azure.yml in the project directory.');
        }

        await this.azd.provision(context.iacFolder!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    }
}
