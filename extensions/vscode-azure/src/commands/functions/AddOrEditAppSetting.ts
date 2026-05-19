/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isVirtualResource, type VirtualResource } from '@microsoft/vscode-azure-azutils';
import { ICodeContext, showSmartInputBox } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureViewDataTree } from '../../services';
import { IFunctionAppDataProvider } from '../../tree/resources/functions/FunctionAppDataProvider';
import { appSettingsParentKey } from '../../tree/resources/functions/appSettingsParentKey';
import type { ManagedCommand } from '../ManagedCommand';

type AppSettingMode = 'add' | 'edit';

/**
 * Adds a new app setting or edits an existing one.
 *
 * The mode is supplied as a prefix arg at registration time:
 * - `'add'`  -- prompts for key + value (invoked on the "App Settings" category node).
 * - `'edit'` -- prompts for a new value (invoked on an individual app setting node).
 */
@injectable()
export class AddOrEditAppSetting implements ManagedCommand {
    public static readonly AddContextValue = 'addFunctionAppSetting';
    public static readonly EditContextValue = 'editFunctionAppSetting';

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IAzureViewDataTree) private readonly cache: IAzureViewDataTree,
        @inject(IFunctionAppDataProvider) private readonly dataProvider: IFunctionAppDataProvider,
    ) { }

    /** @inheritdoc */
    public async execute(mode: AppSettingMode, key?: string): Promise<void> {
        if (!key) {
            return;
        }

        const resource = this.cache.get(key);
        if (!resource || !isVirtualResource(resource)) {
            return;
        }

        switch (mode) {
            case 'add':
                await this.addSetting(key, resource);
                break;
            case 'edit':
                await this.editSetting(key, resource);
                break;
        }
    }

    private async addSetting(key: string, resource: VirtualResource): Promise<void> {
        const settingKey = await showSmartInputBox(this.ctx, {
            prompt: this.ctx.code.l10n.t('Enter the app setting name'),
            placeHolder: this.ctx.code.l10n.t('e.g., MY_SETTING'),
            validateInput: (value) => {
                if (!value.trim()) {
                    return this.ctx.code.l10n.t('Setting name cannot be empty');
                }
                return undefined;
            },
        });

        const settingValue = await showSmartInputBox(this.ctx, {
            prompt: this.ctx.code.l10n.t('Enter the value for \'{0}\'', settingKey),
            placeHolder: this.ctx.code.l10n.t('Setting value'),
        });

        await this.dataProvider.addOrUpdateSetting(resource.azureResource, settingKey, settingValue);
        this.cache.invalidate(resource);

        void this.ctx.code.window.showInformationMessage(
            this.ctx.code.l10n.t('Added app setting \'{0}\'.', settingKey)
        );
    }

    private async editSetting(_key: string, resource: VirtualResource): Promise<void> {
        const settingKey = resource.virtualPath;
        const currentValue = this.dataProvider.getSettingValue(resource.azureResource.id, settingKey) ?? '';

        const newValue = await showSmartInputBox(this.ctx, {
            prompt: this.ctx.code.l10n.t('Enter new value for \'{0}\'', settingKey),
            value: currentValue,
        });

        if (newValue === currentValue) {
            return;
        }

        await this.dataProvider.addOrUpdateSetting(resource.azureResource, settingKey, newValue);

        // Invalidate the parent "App Settings" node to refresh the tree
        const parentResource = this.cache.get(appSettingsParentKey(resource));
        if (parentResource) {
            this.cache.invalidate(parentResource);
        }

        void this.ctx.code.window.showInformationMessage(
            this.ctx.code.l10n.t('Updated app setting \'{0}\'.', settingKey)
        );
    }
}
