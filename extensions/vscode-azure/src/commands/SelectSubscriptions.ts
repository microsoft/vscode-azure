/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeContext, showSmartQuickPick, type QuickPickItemWithData } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { SelectedSubscriptionsConfigurationKey, SubscriptionFilterConfigurationSection } from '../constants';
import { IAzureViewDataTree } from '../services';
import type { ManagedCommand } from './ManagedCommand';
import { listReachableSubscriptions } from './listReachableAuthNodes';

interface SubscriptionPickData {
    readonly id: string;
}

/**
 * Prompts the user to select which subscriptions should be visible in the
 * Azure resources tree and updates `azureResourceGroups.selectedSubscriptions`.
 */
@injectable()
export class SelectSubscriptions implements ManagedCommand {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IAzureViewDataTree) private readonly cache: IAzureViewDataTree,
    ) { }

    /** @inheritdoc */
    public async execute(): Promise<void> {
        const code = this.ctx.code;
        const config = code.workspace.getConfiguration(SubscriptionFilterConfigurationSection);
        const currentSelected = config.get<string[]>(SelectedSubscriptionsConfigurationKey, []);
        const currentSet = new Set(currentSelected.map(id => id.toLowerCase()));

        const reachable = await listReachableSubscriptions(this.cache);
        if (reachable.length === 0) {
            throw new Error(code.l10n.t('No reachable subscriptions were found. Sign in to Azure and try again.'));
        }

        const picks: QuickPickItemWithData<SubscriptionPickData>[] = reachable.map(({ account, tenant, subscription }) => {
            const selectionId = `${tenant.tenantId.toLowerCase()}/${subscription.subscriptionId.toLowerCase()}`;
            return {
                label: code.l10n.t('{0} ({1})', subscription.displayName, subscription.subscriptionId),
                description: code.l10n.t('Tenant: {0}', tenant.displayName),
                detail: code.l10n.t('Tenant ID: {0} | Account: {1}', tenant.tenantId, account.label),
                data: { id: selectionId },
            };
        });

        const selected = await showSmartQuickPick(this.ctx, picks, {
            canPickMany: true,
            placeHolder: code.l10n.t('Select subscriptions to include in the Azure resources view'),
            isSelectedItem: item => currentSet.size === 0 || currentSet.has(item.data.id),
        });

        const selectedIds = [...new Set(selected.map(item => item.data.id))]
            .sort((a, b) => a.localeCompare(b));

        // Persisting an empty list means "no filtering", which is equivalent to
        // selecting every currently reachable subscription.
        const nextValue = selectedIds.length === picks.length ? [] : selectedIds;
        await config.update(SelectedSubscriptionsConfigurationKey, nextValue, code.ConfigurationTarget.Global);
    }
}
