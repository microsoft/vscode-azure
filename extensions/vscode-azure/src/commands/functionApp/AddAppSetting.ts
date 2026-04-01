/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isVirtualResource } from '@microsoft/vscode-azure-azutils';
import { FunctionAppVirtualTypes } from '../../tree/resources/functionApp/functionAppConstants';
import { IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureViewDataTree } from '../../services';
import { FunctionAppDataProvider } from '../../tree/resources/functionApp/FunctionAppDataProvider';
import type { ManagedCommand } from '../ManagedCommand';

/**
 * Prompts for a key and value, then adds a new app setting to the Function App.
 * Invoked from the "App Settings" category node context menu.
 */
@injectable()
export class AddAppSetting implements ManagedCommand {
    public static readonly ContextValue = 'addFunctionAppSetting';

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
        if (!resource || !isVirtualResource(resource) || resource.virtualType !== FunctionAppVirtualTypes.AppSettings) {
            return;
        }

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
}
