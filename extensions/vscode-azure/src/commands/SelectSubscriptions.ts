/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionExecutor, ICodeContext, showSmartQuickPick, stringifyError, type QuickPickItemWithData } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { SelectedSubscriptionsConfigurationKey, SubscriptionFilterConfigurationSection } from '../constants';
import { IAzureViewDataTree } from '../services';
import type { ManagedCommand } from './ManagedCommand';
import { listReachableSubscriptions, type UnreachableAuthNode } from './listReachableAuthNodes';

interface SubscriptionPickData {
    readonly id: string;
}

/**
 * Prompts the user to select which subscriptions should be visible in the
 * Azure resources tree and updates `azureResourceGroups.selectedSubscriptions`.
 *
 * Subscription discovery is *silent* (see {@linkcode listReachableSubscriptions}):
 * accounts/tenants that cannot mint a token without interactive sign-in are
 * skipped and surfaced as a non-blocking warning rather than aborting the whole
 * command, so the user can still filter the subscriptions that did load.
 */
@injectable()
export class SelectSubscriptions implements ManagedCommand {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IAzureViewDataTree) private readonly cache: IAzureViewDataTree,
    ) { }

    /** @inheritdoc */
    public async execute(): Promise<void> {
        const code = this.ctx.code;
        const config = code.workspace.getConfiguration(SubscriptionFilterConfigurationSection);
        const currentSelected = config.get<string[]>(SelectedSubscriptionsConfigurationKey, []);
        const currentSet = new Set(currentSelected.map(id => id.toLowerCase()));

        const { subscriptions: reachable, failures } = await listReachableSubscriptions(this.cache);

        if (failures.length > 0) {
            this.reportFailures(failures);
        }

        if (reachable.length === 0) {
            if (failures.length > 0) {
                throw new Error(code.l10n.t('Could not load subscriptions for any tenant. Sign in to those tenants and try again.'));
            }
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

        // Persisting an empty list means "no filtering" (show everything). Only
        // collapse to that when every reachable subscription was selected AND
        // nothing failed to load: if some tenants failed, an empty list would
        // also unhide the subscriptions we could not enumerate, so persist the
        // explicit id list instead.
        const nextValue = failures.length === 0 && selectedIds.length === picks.length ? [] : selectedIds;
        await config.update(SelectedSubscriptionsConfigurationKey, nextValue, code.ConfigurationTarget.Global);
    }

    /**
     * Log each discovery failure to the output channel (tenant id + error only,
     * no PII) and show a single non-blocking warning naming the tenants that may
     * be missing from the list.
     */
    private reportFailures(failures: UnreachableAuthNode[]): void {
        const code = this.ctx.code;

        for (const failure of failures) {
            this.executor.output.warn(`[selectSubscriptions] could not list subscriptions for tenant=${failure.tenant?.tenantId ?? '<all>'} account=${failure.account.id}: ${stringifyError(failure.error)}`);
        }

        const tenantNames = failures
            .map(failure => failure.tenant?.displayName)
            .filter((name): name is string => !!name);
        const detail = [...new Set(tenantNames)].join(', ');

        void code.window.showWarningMessage(
            detail
                ? code.l10n.t('Some tenants could not be loaded and may be missing from this list: {0}. Sign in to those tenants to include their subscriptions.', detail)
                : code.l10n.t('Some tenants could not be loaded and may be missing from this list. Sign in to those tenants to include their subscriptions.'),
        );
    }
}
