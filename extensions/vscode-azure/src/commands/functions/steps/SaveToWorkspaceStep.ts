/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep, type IVsCode } from '@microsoft/vscode-azure-utils';
import type { TempProjectManager } from '../../../bicep/TempProjectManager';
import type { CreateFunctionAppContext } from '../CreateFunctionAppContext';

/**
 * Copies the generated project files from the temp directory into the
 * user's workspace. Only runs when the user chose to save.
 */
export class SaveToWorkspaceStep extends ExecuteStep<CreateFunctionAppContext> {
    public constructor(
        private readonly code: IVsCode,
        private readonly tempManager: TempProjectManager,
    ) {
        super();
    }

    public shouldExecute(context: Readonly<CreateFunctionAppContext>): boolean {
        return context.saveOrDeploy === 'save' || context.saveOrDeploy === 'saveAndDeploy';
    }

    public async execute(context: CreateFunctionAppContext): Promise<void> {
        const folders = this.code.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            const picked = await this.code.window.showOpenDialog({
                canSelectFolders: true,
                canSelectFiles: false,
                canSelectMany: false,
                openLabel: this.code.l10n.t('Select folder'),
            });
            if (!picked || picked.length === 0) {
                return;
            }
            await this.tempManager.saveToWorkspace(context.projectDir, picked[0].fsPath);
        } else {
            // Use first workspace folder by default
            await this.tempManager.saveToWorkspace(context.projectDir, folders[0].uri.fsPath);
        }
    }
}
