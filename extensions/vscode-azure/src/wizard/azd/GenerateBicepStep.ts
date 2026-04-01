/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep, type IExtensionContext } from '@microsoft/vscode-azure-utils';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { AzdWizardContext } from './AzdWizardContext';

const InfraFolderName = 'infra';
const MainBicepFileName = 'main.bicep';
const MainParametersFileName = 'main.parameters.json';

/**
 * Generates infra files: copies `main.bicep` from the extension's
 * bundled templates and writes a `main.parameters.json` with the
 * user's chosen values.
 *
 * @param parameterKeys - Keys of the wizard context to emit as bicep
 *   parameters (in addition to the always-included `environmentName`
 *   and `location` azd placeholders).
 */
export class GenerateBicepStep<TContext extends AzdWizardContext> extends ExecuteStep<TContext> {
    public constructor(
        private readonly extensionContext: IExtensionContext,
        private readonly templateName: 'functionApp.bicep', // | 'staticWebApp.bicep' | ...
        private readonly parameterKeys: readonly (keyof TContext & string)[],
    ) {
        super();
    }

    public async shouldExecute(context: Readonly<TContext>): Promise<boolean> {
        if (!context.iacFolder) {
            return false;
        }

        const infraFolder = path.join(context.iacFolder, InfraFolderName);

        for (const fileName of [MainBicepFileName, MainParametersFileName]) {
            try {
                await fs.access(path.join(infraFolder, fileName));
                // At least one file already exists; skip generation
                return false;
            } catch {
                // File does not exist; continue checking
            }
        }

        return true;
    }

    public async execute(context: TContext): Promise<void> {
        const templatePath = this.extensionContext.asAbsolutePath(path.join('resources', 'templates', this.templateName));
        const bicepFolder = path.join(context.iacFolder!, InfraFolderName); // eslint-disable-line @typescript-eslint/no-non-null-assertion

        const parameters = JSON.stringify({
            $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#',
            contentVersion: '1.0.0.0',
            parameters: {
                environmentName: { value: '${AZURE_ENV_NAME}' }, // eslint-disable-line no-template-curly-in-string -- azd placeholder
                location: { value: '${AZURE_LOCATION}' }, // eslint-disable-line no-template-curly-in-string -- azd placeholder
                ...this.pickParameters(context),
            },
        }, undefined, 4);

        await fs.mkdir(bicepFolder, { recursive: true });
        await Promise.all([
            fs.writeFile(
                path.join(bicepFolder, MainParametersFileName),
                parameters,
            ),
            fs.copyFile(
                templatePath,
                path.join(bicepFolder, MainBicepFileName),
            ),
        ]);
    }

    private pickParameters(context: TContext): Record<string, { value: unknown }> {
        const result: Record<string, { value: unknown }> = {};
        for (const key of this.parameterKeys) {
            const value = context[key];
            if (value !== undefined) {
                result[key] = { value };
            }
        }
        return result;
    }
}
