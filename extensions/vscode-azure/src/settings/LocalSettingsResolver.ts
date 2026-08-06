/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { GenericResource } from '@microsoft/vscode-azure-azutils';
import { ICodeContext, showSmartQuickPick } from '@microsoft/vscode-azure-utils';
import { inject, injectable, type ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';
import { ISettingsRegistry } from './SettingsRegistry';

export const ILocalSettingsResolver: ServiceIdentifier<ILocalSettingsResolver> = Symbol.for('ILocalSettingsResolver');
export type ILocalSettingsResolver = LocalSettingsResolver;

/**
 * Locates the local file a settings collection syncs with.
 *
 * Which file that is comes from the adapter's declared `localFile` capability, so the local-sync
 * commands never hard-code `local.settings.json` or `.env` for a particular product.
 */
@injectable()
export class LocalSettingsResolver {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(ISettingsRegistry) private readonly registry: ISettingsRegistry,
    ) { }

    /**
     * Resolve the local file for a collection, prompting for a workspace folder when the choice is
     * ambiguous.
     *
     * @returns the file's URI, or `undefined` if the collection has no local-file convention, there
     * is no open workspace, or the user dismissed the folder prompt.
     */
    public async resolve(resource: GenericResource, collectionId: string): Promise<vscode.Uri | undefined> {
        const capabilities = this.registry.getCapabilities(resource, collectionId);
        const fileName = capabilities.localFile?.fileName;
        if (!fileName) {
            void this.ctx.code.window.showInformationMessage(
                this.ctx.code.l10n.t('These settings do not have a local file to sync with.')
            );
            return undefined;
        }

        const folder = await this.pickFolder();
        if (!folder) {
            return undefined;
        }

        return this.ctx.code.Uri.joinPath(folder.uri, fileName);
    }

    private async pickFolder(): Promise<vscode.WorkspaceFolder | undefined> {
        const folders = this.ctx.code.workspace.workspaceFolders ?? [];

        if (folders.length === 0) {
            void this.ctx.code.window.showErrorMessage(
                this.ctx.code.l10n.t('Open a folder or workspace first, so there is somewhere to keep the local settings file.')
            );
            return undefined;
        }

        if (folders.length === 1) {
            return folders[0];
        }

        const picked = await showSmartQuickPick(
            this.ctx,
            folders.map(folder => ({ label: folder.name, description: folder.uri.fsPath, folder })),
            { placeHolder: this.ctx.code.l10n.t('Select the folder holding the local settings file') },
        );

        return picked.folder;
    }
}
