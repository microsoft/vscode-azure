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
 * Prompts for a new value and updates an existing app setting.
 * Invoked from an individual app setting node context menu.
 */
@injectable()
export class EditAppSetting implements ManagedCommand {
    public static readonly ContextValue = 'editFunctionAppSetting';

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
        const currentValue = this.dataProvider.getSettingValue(resource.azureResource.id, settingKey) ?? '';

        const newValue = await this.code.window.showInputBox({
            prompt: this.code.l10n.t('Enter new value for \'{0}\'', settingKey),
            value: currentValue,
        });

        if (newValue === undefined || newValue === currentValue) {
            return;
        }

        await this.dataProvider.addOrUpdateSetting(resource.azureResource, settingKey, newValue);

        // Invalidate the parent "App Settings" node to refresh the tree
        const parentResource = this.cache.get(
            this.findAppSettingsParentKey(key)
        );
        if (parentResource) {
            this.cache.invalidate(parentResource);
        }

        void this.code.window.showInformationMessage(
            this.code.l10n.t('Updated app setting \'{0}\'.', settingKey)
        );
    }

    /**
     * Find the parent "App Settings" category key from an individual setting key.
     * The data tree tracks parent relationships, but we can construct the parent
     * key by stripping the virtual fragment from the setting's AzureNodeId.
     */
    private findAppSettingsParentKey(settingKey: string): string {
        // Individual settings are: azr://...#/functionApp.appSetting/KEY
        // Their parent category is: azr://...#/functionApp.appSettings/App%20Settings
        // Use AzureNodeId.parentNodeId which strips the virtual fragment back to the resource
        // then look up the App Settings category in the cache
        // Simpler: just strip the last fragment and rebuild
        const hashIndex = settingKey.indexOf('#');
        if (hashIndex === -1) {
            return settingKey;
        }
        const base = settingKey.substring(0, hashIndex);
        return `${base}#/functionApp.appSettings/${encodeURIComponent('App Settings')}`;
    }
}
