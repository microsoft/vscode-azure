/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeContext } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { SettingsUri } from '../../settings/SettingsUri';
import { IResourceSelector } from '../../tree/resources/ResourceSelector';
import { isSettingsNode } from '../../tree/resources/settings/SettingsNode';
import type { ManagedCommand } from '../ManagedCommand';

/**
 * Opens a resource's settings for editing.
 *
 * Opens the settings as an in-memory JSONC document whose save writes straight to Azure.
 */
@injectable()
export class EditSettings implements ManagedCommand {
    /** Command id, so the tree item can invoke it directly on click. */
    public static readonly CommandId = 'vscode-azure/settings/edit';
    public static readonly ContextValue = 'editSettings';

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IResourceSelector) private readonly selector: IResourceSelector,
    ) { }

    /** @inheritdoc */
    public async execute(key?: string): Promise<void> {
        const node = await this.selector.selectVirtual({ key, canHandle: isSettingsNode });

        // `preview: false` so the tab is not reused: the URI identifies the resource, and two views
        // of one resource's settings could disagree after a save.
        const document = await this.ctx.code.workspace.openTextDocument(SettingsUri.from(this.ctx.code, node));
        await this.ctx.code.window.showTextDocument(document, { preview: false });
    }
}
