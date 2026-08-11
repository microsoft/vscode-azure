/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { GenericResource } from '@microsoft/vscode-azure-azutils';
import { IVsCode } from '@microsoft/vscode-azure-utils';
import type { SettingsFileSystemProvider } from './core/SettingsFileSystemProvider';
import { inject, injectable, type ServiceIdentifier } from 'inversify';
import { IAzureViewDataTree } from '../services';
import { createCollectionNode } from '../tree/resources/settings/SettingsNode';
import { ISettingsFileSystem } from './registerSettings';
import { SettingsUri } from './SettingsUri';

export const ISettingsChangeNotifier: ServiceIdentifier<ISettingsChangeNotifier> = Symbol.for('ISettingsChangeNotifier');
export type ISettingsChangeNotifier = SettingsChangeNotifier;

/**
 * Announces that a settings collection changed, to every surface showing it.
 *
 * A settings collection is visible in two independent places: the tree and, possibly, an open
 * editor document. Refreshing only the tree leaves an open document holding a stale snapshot, and
 * because saving is last-writer-wins that stale document would silently undo the change on its next
 * save -- not as a concurrent-edit race, but as the same user's own action being reverted in the
 * same window.
 *
 * Every command that mutates settings outside the editor must call {@linkcode notify} rather than
 * invalidating the tree directly.
 */
@injectable()
export class SettingsChangeNotifier {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IAzureViewDataTree) private readonly tree: IAzureViewDataTree,
        @inject(ISettingsFileSystem) private readonly fileSystem: SettingsFileSystemProvider,
    ) { }

    /**
     * Refresh the tree subtree and any open document for one settings collection.
     *
     * Invalidates the collection node rather than the resource, so sibling collections on the same
     * resource keep their cached children.
     */
    public notify(resource: GenericResource, collectionId: string): void {
        const collection = createCollectionNode(resource, collectionId);

        this.tree.invalidate(collection);
        this.fileSystem.invalidate(SettingsUri.from(this.code, collection));
    }
}
