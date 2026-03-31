/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isVirtualResource } from '@microsoft/vscode-azure-azutils';
import { IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureViewDataTree } from '../../services';
import { FunctionAppDataProvider } from '../../tree/resources/functionApp/FunctionAppDataProvider';
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

        const confirm = await this.code.window.showWarningMessage(
            this.code.l10n.t('Are you sure you want to delete app setting \'{0}\'?', settingKey),
            { modal: true },
            this.code.l10n.t('Delete'),
        );

        if (!confirm) {
            return;
        }

        // Show deleting state immediately while the API call is in flight
        this.cache.markState(resource, 'deleting');

        try {
            await this.dataProvider.deleteSetting(resource.azureResource, settingKey);
        } finally {
            this.cache.clearState(resource, 'deleting');
        }

        // Invalidate the parent "App Settings" node to refresh the tree
        const parentResource = this.cache.get(
            this.findAppSettingsParentKey(key)
        );
        if (parentResource) {
            this.cache.invalidate(parentResource);
        }

        void this.code.window.showInformationMessage(
            this.code.l10n.t('Deleted app setting \'{0}\'.', settingKey)
        );
    }

    private findAppSettingsParentKey(settingKey: string): string {
        const hashIndex = settingKey.indexOf('#');
        if (hashIndex === -1) {
            return settingKey;
        }
        const base = settingKey.substring(0, hashIndex);
        return `${base}#/functionApp.appSettings/${encodeURIComponent('App Settings')}`;
    }
}
