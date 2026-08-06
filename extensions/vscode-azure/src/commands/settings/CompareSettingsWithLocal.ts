/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeContext } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureViewDataTree } from '../../services';
import { LocalSettingsDocumentSource } from '../../settings/LocalSettingsDocumentSource';
import { ILocalSettingsResolver } from '../../settings/LocalSettingsResolver';
import { ISettingsRegistry } from '../../settings/SettingsRegistry';
import { SettingsUri } from '../../settings/SettingsUri';
import {
    collectionIdOf, isSettingsEntryNode, isSettingsNode, parentCollectionOf,
} from '../../tree/resources/settings/SettingsNode';
import type { ManagedCommand } from '../ManagedCommand';

/**
 * Opens a side-by-side diff of a settings collection against its local file.
 *
 * Both sides are projected through the same JSONC format, so the diff shows only genuine
 * differences in the settings rather than the structural noise of comparing
 * `local.settings.json`'s `Values` wrapper against a flat map. Either side can be edited and saved
 * in place, which makes reconciling the two a normal merge rather than an all-or-nothing copy.
 */
@injectable()
export class CompareSettingsWithLocal implements ManagedCommand {
    public static readonly ContextValue = 'compareSettingsWithLocal';

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IAzureViewDataTree) private readonly tree: IAzureViewDataTree,
        @inject(ISettingsRegistry) private readonly registry: ISettingsRegistry,
        @inject(ILocalSettingsResolver) private readonly resolver: ILocalSettingsResolver,
        @inject(LocalSettingsDocumentSource) private readonly localSource: LocalSettingsDocumentSource,
    ) { }

    /** @inheritdoc */
    public async execute(key?: string): Promise<void> {
        if (!key) {
            return;
        }

        const node = this.tree.get(key);
        if (!isSettingsNode(node)) {
            return;
        }

        const collection = isSettingsEntryNode(node) ? parentCollectionOf(node) : node;
        const collectionId = collectionIdOf(collection);
        const resource = collection.azureResource;

        const fileUri = await this.resolver.resolve(resource, collectionId);
        if (!fileUri) {
            return;
        }

        const label = this.registry.getCollection(resource, collectionId)?.label ?? collectionId;

        await this.ctx.code.commands.executeCommand(
            'vscode.diff',
            this.localSource.toDocumentUri(fileUri, label),
            SettingsUri.from(this.ctx.code, collection),
            this.ctx.code.l10n.t('{0}: local \u2194 {1} (Azure)', label, resource.name),
        );
    }
}
