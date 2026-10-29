/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { fileExists, getWorkspaceFolder, IVsCode, showMessage } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { requireWorkspaceTrust } from '../../utils/workspaceTrust';
import type { ManagedCommand } from '../ManagedCommand';

/** Name of the Azure Static Web Apps runtime configuration file. */
const staticWebAppConfigFileName = 'staticwebapp.config.json';

/**
 * Starting point written by {@linkcode CreateSwaConfigFile}: a single route
 * rewrite plus the SPA navigation fallback, the two rules most projects reach
 * for first.
 *
 * `$schema` makes the file self-describing, so any editor resolves completions
 * and validation for it rather than only those that match on the file name --
 * this extension's own `jsonValidation` contribution among them.
 */
const staticWebAppExampleConfig = {
    $schema: 'https://json.schemastore.org/staticwebapp.config.json',
    routes: [
        {
            route: '/example',
            rewrite: '/example.html',
        },
    ],
    navigationFallback: {
        rewrite: '/index.html',
    },
};

/** Creates and opens an example `staticwebapp.config.json` in a workspace folder. */
@injectable()
export class CreateSwaConfigFile implements ManagedCommand {
    public constructor(@inject(IVsCode) private readonly code: IVsCode) { }

    /** @inheritdoc */
    public async execute(): Promise<void> {
        requireWorkspaceTrust(this.code);

        const folder = await getWorkspaceFolder(this.code, {
            placeHolder: this.code.l10n.t('Select a workspace folder for \'{0}\'.', staticWebAppConfigFileName),
            stepName: 'Select workspace folder',
        });
        if (!folder) {
            throw new Error(this.code.l10n.t('Open a workspace folder before creating a Static Web Apps configuration file.'));
        }

        const configUri = this.code.Uri.joinPath(folder.uri, staticWebAppConfigFileName);
        if (await fileExists(this.code, configUri)) {
            const overwriteLabel = this.code.l10n.t('Overwrite');
            await showMessage(
                this.code,
                this.code.l10n.t('Static Web App configuration file \'{0}\' already exists.', configUri.fsPath),
                {
                    modal: true,
                    severity: 'warning',
                    stepName: 'Confirm Static Web Apps config overwrite',
                },
                overwriteLabel,
            );
        }

        const contents = `${JSON.stringify(staticWebAppExampleConfig, undefined, 4)}\n`;
        await this.code.workspace.fs.writeFile(configUri, new TextEncoder().encode(contents));
        const document = await this.code.workspace.openTextDocument(configUri);
        await this.code.window.showTextDocument(document);
    }

}
