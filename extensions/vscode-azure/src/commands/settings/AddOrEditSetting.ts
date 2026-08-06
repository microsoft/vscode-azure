/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type GenericResource } from '@microsoft/vscode-azure-azutils';
import { ICodeContext, showSmartInputBox, UnreadableValue } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureViewDataTree } from '../../services';
import { ISettingsChangeNotifier } from '../../settings/SettingsChangeNotifier';
import { ISettingsRegistry } from '../../settings/SettingsRegistry';
import {
    collectionIdOf, isSettingsCollectionNode, isSettingsEntryNode, settingKeyOf,
} from '../../tree/resources/settings/SettingsNode';
import type { ManagedCommand } from '../ManagedCommand';

type Mode = 'add' | 'edit';

/**
 * Adds a new setting, or changes the value of an existing one.
 *
 * The mode is supplied as a prefix arg at registration time:
 * - `'add'`  -- invoked on a collection node; prompts for a key, then a value.
 * - `'edit'` -- invoked on an individual setting; prompts for a new value, pre-filled.
 *
 * Both are conveniences over the editor, which remains the way to change several settings at once.
 */
@injectable()
export class AddOrEditSetting implements ManagedCommand {
    public static readonly AddContextValue = 'addSetting';
    public static readonly EditContextValue = 'editSettingValue';

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IAzureViewDataTree) private readonly tree: IAzureViewDataTree,
        @inject(ISettingsChangeNotifier) private readonly notifier: ISettingsChangeNotifier,
        @inject(ISettingsRegistry) private readonly registry: ISettingsRegistry,
    ) { }

    /** @inheritdoc */
    public async execute(mode: Mode, key?: string): Promise<void> {
        if (!key) {
            return;
        }

        const node = this.tree.get(key);

        if (mode === 'add') {
            if (!isSettingsCollectionNode(node)) {
                return;
            }
            await this.add(node.azureResource, collectionIdOf(node));
            return;
        }

        if (!isSettingsEntryNode(node)) {
            return;
        }
        await this.edit(node.azureResource, collectionIdOf(node), settingKeyOf(node), node.value);
    }

    private async add(resource: GenericResource, collectionId: string): Promise<void> {
        const capabilities = this.registry.getCapabilities(resource, collectionId);

        const existing = (await this.registry.read(resource, collectionId)).entries;

        const settingKey = await showSmartInputBox(this.ctx, {
            prompt: this.ctx.code.l10n.t('Enter the new setting name'),
            placeHolder: this.ctx.code.l10n.t('e.g., MY_SETTING'),
            validateInput: (value) => {
                const trimmed = value.trim();
                if (!trimmed) {
                    return this.ctx.code.l10n.t('The setting name cannot be empty.');
                }
                if (existing.some(entry => entry.key === trimmed)) {
                    return this.ctx.code.l10n.t('A setting named \'{0}\' already exists.', trimmed);
                }
                return capabilities.validateKey?.(trimmed);
            },
        });

        const settingValue = await showSmartInputBox(this.ctx, {
            prompt: this.ctx.code.l10n.t('Enter the value for \'{0}\'', settingKey.trim()),
            placeHolder: this.ctx.code.l10n.t('Setting value'),
            // A setting value is frequently a secret. Never persist it to workspace state, and
            // never offer another resource's value as the pre-filled default here.
            rememberRecent: false,
        });

        await this.registry.upsert(resource, collectionId, { key: settingKey.trim(), value: settingValue });
        this.notifier.notify(resource, collectionId);

        void this.ctx.code.window.showInformationMessage(
            this.ctx.code.l10n.t('Added the setting \'{0}\'.', settingKey.trim())
        );
    }

    private async edit(
        resource: GenericResource,
        collectionId: string,
        settingKey: string,
        currentValue: string,
    ): Promise<void> {
        // A value the service refuses to return must not be offered as the starting point, or
        // accepting the prompt unchanged would write the placeholder over the real secret.
        const readable = currentValue !== UnreadableValue;

        const newValue = await showSmartInputBox(this.ctx, {
            prompt: this.ctx.code.l10n.t('Enter the new value for \'{0}\'', settingKey),
            value: readable ? currentValue : '',
            placeHolder: readable ? undefined : this.ctx.code.l10n.t('The current value cannot be shown'),
            // See the note in `add`: setting values must not be persisted to workspace state.
            rememberRecent: false,
        });

        if (readable && newValue === currentValue) {
            return;
        }

        const existing = (await this.registry.read(resource, collectionId)).entries
            .find(entry => entry.key === settingKey);

        await this.registry.upsert(resource, collectionId, {
            key: settingKey,
            value: newValue,
            // Preserve structured metadata (e.g. a connection string's type) across a value edit.
            metadata: existing?.metadata,
        });
        this.notifier.notify(resource, collectionId);

        void this.ctx.code.window.showInformationMessage(
            this.ctx.code.l10n.t('Updated the setting \'{0}\'.', settingKey)
        );
    }
}
