/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError, fileExists, IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import type { ManagedCommand } from '../ManagedCommand';

/** Name of the Azure Static Web Apps runtime configuration file. */
export const staticWebAppConfigFileName = 'staticwebapp.config.json';

/** Source-compatible example written by {@linkcode CreateSwaConfigFile}. */
export const staticWebAppExampleConfig = `{
    "routes": [
        {
            "route": "/example",
            "rewrite": "/example.html"
        }
    ],
    "navigationFallback": {
        "rewrite": "/index.html"
    }
}`;

/** Creates and opens an example `staticwebapp.config.json` in a workspace folder. */
@injectable()
export class CreateSwaConfigFile implements ManagedCommand {
    public constructor(@inject(IVsCode) private readonly code: IVsCode) { }

    /** @inheritdoc */
    public async execute(): Promise<void> {
        const folder = await this.selectWorkspaceFolder();
        if (!folder) {
            throw new CancellationError(undefined, 'Select workspace folder');
        }

        const configUri = this.code.Uri.joinPath(folder.uri, staticWebAppConfigFileName);
        if (await fileExists(this.code, configUri)) {
            const overwriteLabel = this.code.l10n.t('Overwrite');
            const response = await this.code.window.showWarningMessage(
                this.code.l10n.t('Static Web App configuration file \'{0}\' already exists.', configUri.fsPath),
                { modal: true },
                overwriteLabel,
            );
            if (response !== overwriteLabel) {
                throw new CancellationError(undefined, 'Confirm Static Web Apps config overwrite');
            }
        }

        await this.code.workspace.fs.writeFile(configUri, new TextEncoder().encode(staticWebAppExampleConfig));
        const document = await this.code.workspace.openTextDocument(configUri);
        await this.code.window.showTextDocument(document);
    }

    private async selectWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
        const folders = this.code.workspace.workspaceFolders;
        if (!folders?.length) {
            throw new Error(this.code.l10n.t('Open a workspace folder before creating a Static Web Apps configuration file.'));
        } else if (folders.length === 1) {
            return folders[0];
        }
        return this.code.window.showWorkspaceFolderPick({
            placeHolder: this.code.l10n.t('Select a workspace folder for \'{0}\'.', staticWebAppConfigFileName),
        });
    }

}
