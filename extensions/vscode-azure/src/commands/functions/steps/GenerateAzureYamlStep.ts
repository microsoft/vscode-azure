/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep } from '@microsoft/vscode-azure-utils';
import type { CreateFunctionAppContext } from '../CreateFunctionAppContext';

/**
 * Generates the `azure.yaml` stub for the project.
 */
export class GenerateAzureYamlStep extends ExecuteStep<CreateFunctionAppContext> {
    public execute(context: CreateFunctionAppContext): void {
        const yaml = [
            `name: ${context.functionAppName}`,
            'infra:',
            '  provider: bicep',
            '  path: ./infra',
            '',
        ].join('\n');

        context.azureYamlContent = yaml;
    }
}
