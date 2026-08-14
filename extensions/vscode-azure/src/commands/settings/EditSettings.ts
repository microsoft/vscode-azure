/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeContext } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureViewDataTree } from '../../services';
import { SettingsUri } from '../../settings/SettingsUri';
import { isSettingsNode } from '../../tree/resources/settings/SettingsNode';
import type { ManagedCommand } from '../ManagedCommand';

/**
 * Opens a resource's settings for editing.
 *
 * This is the only settings command, and the fork point between the two editing experiences. Today
 * it opens the settings as an in-memory JSONC document whose save writes straight to Azure.
 *
 * @remarks
 * A second branch is planned: when the resource can be positively attributed to a local azd project,
 * the project's Bicep template is the declarative source of truth and should be edited instead, with
 * a prompt to re-provision on save. That branch depends on the azd association service being added
 * by another change, so it is deliberately absent rather than half-built here.
 */
@injectable()
export class EditSettings implements ManagedCommand {
    /** Command id, so the tree item can invoke it directly on click. */
    public static readonly CommandId = 'vscode-azure/settings/edit';
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

        // `preview: false` so the tab is not reused: the URI identifies the resource, and two views
        // of one resource's settings could disagree after a save.
        const document = await this.ctx.code.workspace.openTextDocument(SettingsUri.from(this.ctx.code, node));
        await this.ctx.code.window.showTextDocument(document, { preview: false });
    }
}
