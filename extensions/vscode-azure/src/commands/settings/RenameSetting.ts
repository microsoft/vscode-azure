/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeContext, showSmartInputBox } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureViewDataTree } from '../../services';
import { ISettingsChangeNotifier } from '../../settings/SettingsChangeNotifier';
import { ISettingsRegistry } from '../../settings/SettingsRegistry';
import {
    collectionIdOf, isSettingsEntryNode, settingKeyOf,
} from '../../tree/resources/settings/SettingsNode';
import type { ManagedCommand } from '../ManagedCommand';

/**
 * Renames a setting, preserving its value and any structured metadata.
 *
 * Worth having as its own command because the obvious manual equivalent -- delete then re-add --
 * requires the user to know the value, which is impossible for a collection whose values cannot be
 * read back.
 */
@injectable()
export class RenameSetting implements ManagedCommand {
    public static readonly ContextValue = 'renameSetting';

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
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

        const resource = node.azureResource;
        const collectionId = collectionIdOf(node);
        const currentKey = settingKeyOf(node);

        const capabilities = this.registry.getCapabilities(resource, collectionId);
        const existing = (await this.registry.read(resource, collectionId)).entries;

        const newKey = await showSmartInputBox(this.ctx, {
            prompt: this.ctx.code.l10n.t('Enter the new name for \'{0}\'', currentKey),
            value: currentKey,
            validateInput: (value) => {
                const trimmed = value.trim();
                if (!trimmed) {
                    return this.ctx.code.l10n.t('The setting name cannot be empty.');
                }
                if (trimmed !== currentKey && existing.some(entry => entry.key === trimmed)) {
                    return this.ctx.code.l10n.t('A setting named \'{0}\' already exists.', trimmed);
                }
                return capabilities.validateKey?.(trimmed);
            },
        });

        const trimmed = newKey.trim();
        if (trimmed === currentKey) {
            return;
        }

        try {
            await this.registry.rename(resource, collectionId, currentKey, trimmed);
        } finally {
            this.notifier.notify(resource, collectionId);
        }

        void this.ctx.code.window.showInformationMessage(
            this.ctx.code.l10n.t('Renamed \'{0}\' to \'{1}\'.', currentKey, trimmed)
        );
    }
}
