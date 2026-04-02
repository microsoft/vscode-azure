/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isVirtualResource, type VirtualResource } from '@microsoft/vscode-azure-azutils';
import { IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureViewDataTree } from '../../services';
import { FunctionAppVirtualTypes } from '../../tree/resources/functionApp/FunctionApp';
import { FunctionAppDataProvider } from '../../tree/resources/functionApp/FunctionAppDataProvider';
import { appSettingsParentKey } from '../../tree/resources/functionApp/appSettingsParentKey';
import type { ManagedCommand } from '../ManagedCommand';

/**
 * Adds a new app setting or edits an existing one, depending on the
 * node that triggered the command.
 *
 * - Invoked on the "App Settings" category node: prompts for key + value (Add flow).
 * - Invoked on an individual app setting node: prompts for a new value (Edit flow).
 */
@injectable()
export class AddOrEditAppSetting implements ManagedCommand {
    public static readonly AddContextValue = 'addFunctionAppSetting';
    public static readonly EditContextValue = 'editFunctionAppSetting';

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
        if (!resource || !isVirtualResource(resource)) {
            return;
        }

        if (resource.virtualType === FunctionAppVirtualTypes.AppSettings) {
            await this.addSetting(key, resource);
        } else if (resource.virtualType === FunctionAppVirtualTypes.AppSetting) {
            await this.editSetting(key, resource);
        }
    }

    private async addSetting(key: string, resource: VirtualResource): Promise<void> {
        const settingKey = await this.code.window.showInputBox({
            prompt: this.code.l10n.t('Enter the app setting name'),
            placeHolder: this.code.l10n.t('e.g., MY_SETTING'),
            validateInput: (value) => {
                if (!value.trim()) {
                    return this.code.l10n.t('Setting name cannot be empty');
                }
                return undefined;
            },
        });

        if (!settingKey) {
            return;
        }

        const settingValue = await this.code.window.showInputBox({
            prompt: this.code.l10n.t('Enter the value for \'{0}\'', settingKey),
            placeHolder: this.code.l10n.t('Setting value'),
        });

        if (settingValue === undefined) {
            return;
        }

        await this.dataProvider.addOrUpdateSetting(resource.azureResource, settingKey, settingValue);
        this.cache.invalidate(resource);

        void this.code.window.showInformationMessage(
            this.code.l10n.t('Added app setting \'{0}\'.', settingKey)
        );
    }

    private async editSetting(_key: string, resource: VirtualResource): Promise<void> {
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
