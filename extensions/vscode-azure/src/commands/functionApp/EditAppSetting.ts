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
        const parentResource = this.cache.get(appSettingsParentKey(resource));
        if (parentResource) {
            this.cache.invalidate(parentResource);
        }

        void this.code.window.showInformationMessage(
            this.code.l10n.t('Updated app setting \'{0}\'.', settingKey)
        );
    }
}
