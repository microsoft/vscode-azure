/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep } from '@microsoft/vscode-azure-utils';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { AzdWizardContext } from './AzdWizardContext';

/**
 * Generates the `azure.yaml` stub for the project.
 */
export class GenerateAzureYamlStep extends ExecuteStep<AzdWizardContext> {
    public async shouldExecute(context: Readonly<AzdWizardContext>): Promise<boolean> {
        // Do not execute if an existing azure.yaml file is found or if `iacFolder` is unset
        return !!context.iacFolder && Promise.resolve(false); // TODO
    }

    public async execute(context: AzdWizardContext): Promise<void> {
        const yaml = [
            `name: ${context.appName}`,
            'infra:',
            '  provider: bicep',
            '  path: ./infra',
            '',
        ].join('\n');

        await fs.writeFile(
            path.join(context.iacFolder!, 'azure.yaml'), // eslint-disable-line @typescript-eslint/no-non-null-assertion
            yaml,
            { mode: 0o600 }
        );
    }
}
