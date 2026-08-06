/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { inject, injectable } from 'inversify';
import { IAzureViewDataTree } from '../../services';
import { ISettingsValueVisibility } from '../../settings/SettingsValueVisibility';
import { isSettingsEntryNode } from '../../tree/resources/settings/SettingsNode';
import type { ManagedCommand } from '../ManagedCommand';

/**
 * Shows or hides setting values in the tree.
 *
 * Only labels change, so this invalidates with a `'self'` verdict over settings entries: matched
 * nodes re-render but keep their cached children, and nothing is re-fetched from Azure. Expanded
 * nodes stay expanded and no other part of the tree is disturbed.
 */
@injectable()
export class ToggleSettingValues implements ManagedCommand {
    public static readonly ContextValue = 'toggleSettingValues';

    public constructor(
        @inject(ISettingsValueVisibility) private readonly visibility: ISettingsValueVisibility,
        @inject(IAzureViewDataTree) private readonly tree: IAzureViewDataTree,
    ) { }

    /** @inheritdoc */
    public async execute(): Promise<void> {
        await this.visibility.toggle();

        this.tree.invalidate(node => isSettingsEntryNode(node) ? 'self' : undefined);
    }
}
