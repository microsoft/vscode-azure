/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep } from '@microsoft/vscode-azure-utils';
import * as fs from 'fs/promises';
import type { AzdWizardContext } from './AzdWizardContext';

/**
 * Generates a `main.parameters.json` file with the user's chosen
 * values. The `main.bicep` template is copied as-is from the
 * extension resources by a later step.
 */
export class GenerateBicepStep<T> extends ExecuteStep<AzdWizardContext<T>> {
    public async shouldExecute(context: Readonly<AzdWizardContext<T>>): Promise<boolean> {
        // Look for existing infra and do not overwrite or if `iacDir` is unset
        return Promise.resolve(true); // TODO
    }

    public async execute(context: AzdWizardContext<T>): Promise<void> {
        const parameters = {
            $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#',
            contentVersion: '1.0.0.0',
            parameters: {
                environmentName: { value: '${AZURE_ENV_NAME}' }, // eslint-disable-line no-template-curly-in-string -- azd placeholder
                location: { value: '${AZURE_LOCATION}' }, // eslint-disable-line no-template-curly-in-string -- azd placeholder
                ...Object.entries(context.bicepOptions ?? {}).reduce((acc, [key, val]) => ({ ...acc, [key]: { value: val } }), {}),
            },
        };

        const parametersJson = JSON.stringify(parameters, undefined, 4);
        await fs.writeFile('TODO', parametersJson); // TODO: write to context.iacFolder/main.parameters.json
    }
}
