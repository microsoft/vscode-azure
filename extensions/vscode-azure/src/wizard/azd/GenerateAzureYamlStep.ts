/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep } from '@microsoft/vscode-azure-utils';
import type { AzdWizardContext } from './AzdWizardContext';

/**
 * Generates the `azure.yaml` stub for the project.
 */
export class GenerateAzureYamlStep extends ExecuteStep<AzdWizardContext> {
    public async shouldExecute(context: Readonly<AzdWizardContext>): Promise<boolean> {
        // Do not execute if an existing azure.yaml file is found or if `iacDir` is unset
        return Promise.resolve(false); // TODO
    }

    public execute(context: AzdWizardContext): void {
        const yaml = [
            `name: ${context.appName}`,
            'infra:',
            '  provider: bicep',
            '  path: ./infra',
            '',
        ].join('\n');

        // TODO: write the file
        throw new Error('unimpl');
    }
}
