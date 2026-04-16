/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { GroupingStrategy } from '@microsoft/vscode-azure-azutils';
import { ICodeContext, showSmartInputBox, showSmartQuickPick, type QuickPickItemWithData } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { ConfigurationSection } from '../constants';
import type { ManagedCommand } from './ManagedCommand';

@injectable()
export class GroupBy implements ManagedCommand {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
    ) { }

    public async execute(): Promise<void> {
        const code = this.ctx.code;
        const config = code.workspace.getConfiguration(ConfigurationSection);
        const current = config.get<GroupingStrategy>('groupBy', 'resourceGroup');

        const items: QuickPickItemWithData<GroupingStrategy>[] = [
            { label: code.l10n.t('Resource Group'), data: 'resourceGroup' },
            { label: code.l10n.t('Resource Type'), data: 'resourceType' },
            { label: code.l10n.t('Location'), data: 'location' },
            { label: code.l10n.t('ARM Tag'), data: 'armTag' },
        ];

        const selected = await showSmartQuickPick(this.ctx, items, {
            placeHolder: code.l10n.t('Select a grouping strategy'),
            isActiveItem: item => item.data === current,
        });

        if (selected.data === 'armTag') {
            const currentTag = config.get<string>('groupByTag', '');
            const tagName = await showSmartInputBox(this.ctx, {
                prompt: code.l10n.t('Enter the ARM tag name to group by'),
                value: currentTag,
                validateInput: (value: string) => value.trim() ? undefined : code.l10n.t('Tag name cannot be empty.'),
            });

            await config.update('groupByTag', tagName.trim(), code.ConfigurationTarget.Global);
        }

        await config.update('groupBy', selected.data, code.ConfigurationTarget.Global);
    }
}
