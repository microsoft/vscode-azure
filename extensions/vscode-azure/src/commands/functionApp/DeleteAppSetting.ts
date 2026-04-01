/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isVirtualResource } from '@microsoft/vscode-azure-azutils';
import { IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureViewDataTree } from '../../services';
import { FunctionAppDataProvider } from '../../tree/resources/functionApp/FunctionAppDataProvider';
import { appSettingsParentKey } from '../../tree/resources/functionApp/appSettingsParentKey';
import type { ManagedCommand } from '../ManagedCommand';

/**
 * Deletes an app setting after user confirmation.
 * Invoked from an individual app setting node context menu.
 */
@injectable()
export class DeleteAppSetting implements ManagedCommand {
    public static readonly ContextValue = 'deleteFunctionAppSetting';

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IAzureViewDataTree) private readonly cache: IAzureViewDataTree,
        @inject(FunctionAppDataProvider) private readonly dataProvider: FunctionAppDataProvider,
    ) { }

    public async execute(key?: string): Promise<void> {
        if (!key) {
            return;
        }

        const resource = this.cache.get(key);
        if (!resource || !isVirtualResource(resource) || resource.virtualType !== 'functionApp.appSetting') {
            return;
        }

        const settingKey = resource.virtualPath;

        const deleteLabel = this.code.l10n.t('Delete');
        const confirm = await this.code.window.showWarningMessage(
            this.code.l10n.t('Are you sure you want to delete app setting \'{0}\'?', settingKey),
            { modal: true },
            deleteLabel,
        );

        if (confirm !== deleteLabel) {
            return;
        }

        try {
            await this.dataProvider.deleteSetting(resource.azureResource, settingKey);
        } finally {
            // Always invalidate the parent to refresh the tree,
            // even on error, so the UI stays in sync
            const parentResource = this.cache.get(appSettingsParentKey(resource));
            if (parentResource) {
                this.cache.invalidate(parentResource);
            }
        }

        void this.code.window.showInformationMessage(
            this.code.l10n.t('Deleted app setting \'{0}\'.', settingKey)
        );
    }
}
