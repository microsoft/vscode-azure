/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep } from '@microsoft/vscode-azure-utils';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { AzdWizardContext } from './AzdWizardContext';

const AzureYamlFileName = 'azure.yaml';

/**
 * Generates the `azure.yaml` stub for the project.
 */
export class GenerateAzureYamlStep extends ExecuteStep<AzdWizardContext> {
    public override async shouldExecute(context: Readonly<AzdWizardContext>): Promise<boolean> {
        if (!context.iacFolder) {
            return false;
        }

        const azureYamlPath = path.join(context.iacFolder, AzureYamlFileName);

        try {
            await fs.access(azureYamlPath);
            // File exists; skip generation
            return false;
        } catch {
            // File does not exist; proceed with generation
            return true;
        }
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
            path.join(context.iacFolder!, AzureYamlFileName), // eslint-disable-line @typescript-eslint/no-non-null-assertion
            yaml,
        );
    }
}
