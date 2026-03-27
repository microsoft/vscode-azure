/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep, IExtensionContext } from '@microsoft/vscode-azure-utils';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { AzdWizardContext } from './AzdWizardContext';

/**
 * Generates infra files: copies `main.bicep` from the extension's
 * bundled templates and writes a `main.parameters.json` with the
 * user's chosen values.
 */
export class GenerateBicepStep<T> extends ExecuteStep<AzdWizardContext<T>> {
    public constructor(
        private readonly extensionContext: IExtensionContext,
        private readonly templateName: 'functionApp.bicep', // | 'staticWebApp.bicep' | ...
    ) {
        super();
    }

    public async shouldExecute(context: Readonly<AzdWizardContext<T>>): Promise<boolean> {
        // Look for existing infra and do not overwrite or if `iacFolder` is unset
        return !!context.iacFolder && Promise.resolve(true); // TODO
    }

    public async execute(context: AzdWizardContext<T>): Promise<void> {
        const templatePath = this.extensionContext.asAbsolutePath(path.join('resources', 'templates', this.templateName));
        const bicepFolder = path.join(context.iacFolder!, 'infra'); // eslint-disable-line @typescript-eslint/no-non-null-assertion

        const parameters = JSON.stringify({
            $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#',
            contentVersion: '1.0.0.0',
            parameters: {
                environmentName: { value: '${AZURE_ENV_NAME}' }, // eslint-disable-line no-template-curly-in-string -- azd placeholder
                location: { value: '${AZURE_LOCATION}' }, // eslint-disable-line no-template-curly-in-string -- azd placeholder
                ...Object.entries(context.bicepOptions ?? {}).reduce((acc, [key, val]) => ({ ...acc, [key]: { value: val } }), {}),
            },
        }, undefined, 4);

        await fs.mkdir(bicepFolder, { recursive: true, mode: 0o700 });
        await Promise.all([
            fs.writeFile(
                path.join(bicepFolder, 'main.parameters.json'),
                parameters,
                { mode: 0o600 }
            ),
            fs.copyFile(
                templatePath,
                path.join(bicepFolder, 'main.bicep'),
                0o600
            ),
        ]);
    }
}
