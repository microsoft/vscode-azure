/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep, type IVsCode } from '@microsoft/vscode-azure-utils';
import { execAzd, findAzureYaml } from '../../utils/azdUtils';
import type { AzdWizardContext } from './AzdWizardContext';

/**
 * Generates the `azure.yaml` stub for the project.
 */
export class GenerateAzureYamlStep<TContext extends AzdWizardContext> extends ExecuteStep<TContext> {
    public constructor(
        private readonly code: IVsCode,
    ) {
        super();
    }

    public override async shouldExecute(context: Readonly<TContext>): Promise<boolean> {
        if (!context.iacFolder) {
            return false;
        }

        return !(await findAzureYaml(this.code, context.iacFolder));
    }

    public async execute(context: TContext): Promise<void> {
        await execAzd(['init', '--minimal', '--no-prompt'], context.iacFolder!.fsPath); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    }
}
