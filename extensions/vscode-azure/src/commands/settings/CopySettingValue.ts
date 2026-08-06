/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVsCode, UnreadableValue } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureViewDataTree } from '../../services';
import { isSettingsEntryNode, settingKeyOf } from '../../tree/resources/settings/SettingsNode';
import type { ManagedCommand } from '../ManagedCommand';

/**
 * Copies a setting's value to the clipboard.
 *
 * Exists so that reading a value does not require revealing it in the tree for everyone watching,
 * which is the common reason people flip the show-values toggle on and forget to flip it back.
 */
@injectable()
export class CopySettingValue implements ManagedCommand {
    public static readonly ContextValue = 'copySettingValue';

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IAzureViewDataTree) private readonly tree: IAzureViewDataTree,
    ) { }

    /** @inheritdoc */
    public async execute(key?: string): Promise<void> {
        if (!key) {
            return;
        }

        const node = this.tree.get(key);
        if (!isSettingsEntryNode(node)) {
            return;
        }

        if (node.value === UnreadableValue) {
            void this.code.window.showWarningMessage(
                this.code.l10n.t('The value of \'{0}\' cannot be read back from Azure, so there is nothing to copy.', settingKeyOf(node))
            );
            return;
        }

        await this.code.env.clipboard.writeText(node.value);

        // Deliberately does not echo the value into the notification.
        void this.code.window.showInformationMessage(
            this.code.l10n.t('Copied the value of \'{0}\' to the clipboard.', settingKeyOf(node))
        );
    }
}
