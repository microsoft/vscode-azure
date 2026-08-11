/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeContext } from '@microsoft/vscode-azure-utils';
import { openSettingsDocument } from '../../settings/core/openSettingsDocument';
import { inject, injectable } from 'inversify';
import { IAzureViewDataTree } from '../../services';
import { SettingsUri } from '../../settings/SettingsUri';
import { isSettingsNode, parentCollectionOf, isSettingsEntryNode } from '../../tree/resources/settings/SettingsNode';
import type { ManagedCommand } from '../ManagedCommand';

/**
 * Opens a settings collection as an editable JSONC document.
 *
 * This is the primary way to view and change settings: the whole collection at once, with the
 * editor's own find, multi-cursor, and undo. The per-setting tree commands exist for one-off edits.
 *
 * Invoked from a collection node, or from an individual setting (which opens the collection that
 * contains it).
 */
@injectable()
export class EditSettings implements ManagedCommand {
    public static readonly ContextValue = 'editSettings';

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IAzureViewDataTree) private readonly tree: IAzureViewDataTree,
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

        // An entry node opens its containing collection, so the command works from either level.
        const collection = isSettingsEntryNode(node) ? parentCollectionOf(node) : node;

        await openSettingsDocument(this.ctx.code, SettingsUri.from(this.ctx.code, collection));
    }
}
