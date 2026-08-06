/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { GenericResource } from '@microsoft/vscode-azure-azutils';
import { diffSettings, ICodeContext, type SettingsMap } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureViewDataTree } from '../../services';
import { ISettingsChangeNotifier } from '../../settings/SettingsChangeNotifier';
import { LocalSettingsDocumentSource } from '../../settings/LocalSettingsDocumentSource';
import { ILocalSettingsResolver } from '../../settings/LocalSettingsResolver';
import { ISettingsRegistry } from '../../settings/SettingsRegistry';
import {
    collectionIdOf, isSettingsEntryNode, isSettingsNode, parentCollectionOf,
} from '../../tree/resources/settings/SettingsNode';
import type { ManagedCommand } from '../ManagedCommand';

type Direction = 'download' | 'upload';

/**
 * Copies a settings collection between Azure and its local file, in one direction.
 *
 * These are conveniences over {@linkcode CompareSettingsWithLocal}: they do wholesale what the diff
 * lets you do selectively. Because a wholesale copy can silently destroy settings that exist only on
 * the destination, both directions summarize the change and require confirmation first.
 *
 * The direction is supplied as a prefix arg at registration time.
 */
@injectable()
export class SyncSettingsWithLocal implements ManagedCommand {
    public static readonly DownloadContextValue = 'downloadSettings';
    public static readonly UploadContextValue = 'uploadSettings';

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IAzureViewDataTree) private readonly tree: IAzureViewDataTree,
        @inject(ISettingsChangeNotifier) private readonly notifier: ISettingsChangeNotifier,
        @inject(ISettingsRegistry) private readonly registry: ISettingsRegistry,
        @inject(ILocalSettingsResolver) private readonly resolver: ILocalSettingsResolver,
        @inject(LocalSettingsDocumentSource) private readonly localSource: LocalSettingsDocumentSource,
    ) { }

    /** @inheritdoc */
    public async execute(direction: Direction, key?: string): Promise<void> {
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
        const documentUri = this.localSource.toDocumentUri(fileUri, label);

        const remote = (await this.registry.read(resource, collectionId)).entries;
        const local = (await this.localSource.read(documentUri)).entries;

        const [source, destination] = direction === 'download' ? [remote, local] : [local, remote];

        if (!await this.confirm(direction, source, destination, resource)) {
            return;
        }

        if (direction === 'download') {
            await this.localSource.write(documentUri, source);
        } else {
            await this.registry.write(resource, collectionId, source);
            this.notifier.notify(resource, collectionId);
        }

        void this.ctx.code.window.showInformationMessage(
            direction === 'download'
                ? this.ctx.code.l10n.t('Downloaded {0} setting(s) from \'{1}\'.', source.length, resource.name)
                : this.ctx.code.l10n.t('Uploaded {0} setting(s) to \'{1}\'.', source.length, resource.name)
        );
    }

    /**
     * Summarize the change and ask for confirmation.
     *
     * The counts, not the keys, are shown: a setting name can itself be sensitive, and the
     * notification surface is not a good place to leak one.
     */
    private async confirm(
        direction: Direction,
        source: SettingsMap,
        destination: SettingsMap,
        resource: GenericResource,
    ): Promise<boolean> {
        const changes = diffSettings(destination, source);
        if (changes.length === 0) {
            void this.ctx.code.window.showInformationMessage(
                this.ctx.code.l10n.t('The local and Azure settings already match. Nothing to do.')
            );
            return false;
        }

        const added = changes.filter(change => change.kind === 'added').length;
        const changed = changes.filter(change => change.kind === 'changed').length;
        const removed = changes.filter(change => change.kind === 'removed').length;

        const target = direction === 'download'
            ? this.ctx.code.l10n.t('the local file')
            : this.ctx.code.l10n.t('\'{0}\' in Azure', resource.name);

        const proceed = this.ctx.code.l10n.t('Overwrite');
        const answer = await this.ctx.code.window.showWarningMessage(
            this.ctx.code.l10n.t(
                'This replaces the settings in {0}: {1} added, {2} changed, {3} deleted. Deleted settings cannot be recovered.',
                target, added, changed, removed,
            ),
            { modal: true },
            proceed,
        );

        return answer === proceed;
    }
}
