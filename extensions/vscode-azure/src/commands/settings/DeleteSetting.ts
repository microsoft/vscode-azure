/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureViewDataTree } from '../../services';
import { ISettingsChangeNotifier } from '../../settings/SettingsChangeNotifier';
import { ISettingsRegistry } from '../../settings/SettingsRegistry';
import {
    collectionIdOf, isSettingsEntryNode, settingKeyOf,
} from '../../tree/resources/settings/SettingsNode';
import type { ManagedCommand } from '../ManagedCommand';

/**
 * Deletes a setting, after a modal confirmation.
 *
 * Confirmation is modal because the delete is immediate and irreversible on the service -- there is
 * no undo, unlike the editor path where an unsaved document can simply be closed.
 */
@injectable()
export class DeleteSetting implements ManagedCommand {
    public static readonly ContextValue = 'deleteSetting';

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IAzureViewDataTree) private readonly tree: IAzureViewDataTree,
        @inject(ISettingsChangeNotifier) private readonly notifier: ISettingsChangeNotifier,
        @inject(ISettingsRegistry) private readonly registry: ISettingsRegistry,
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

        const settingKey = settingKeyOf(node);
        const collectionId = collectionIdOf(node);

        const deleteLabel = this.code.l10n.t('Delete');
        const confirm = await this.code.window.showWarningMessage(
            this.code.l10n.t('Are you sure you want to delete the setting \'{0}\'? This cannot be undone.', settingKey),
            { modal: true },
            deleteLabel,
        );

        if (confirm !== deleteLabel) {
            return;
        }

        try {
            await this.registry.remove(node.azureResource, collectionId, settingKey);
        } finally {
            // Refresh even on failure, so a partially-applied or rejected change does not leave the
            // tree asserting something untrue.
            this.notifier.notify(node.azureResource, collectionId);
        }

        void this.code.window.showInformationMessage(
            this.code.l10n.t('Deleted the setting \'{0}\'.', settingKey)
        );
    }
}
