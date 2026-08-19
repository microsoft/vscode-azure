/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription } from '@microsoft/vscode-azure-azutils';
import { IActionContext, IActionExecutor, ICodeContext, showMessage, showSmartQuickPick, stringifyError, type QuickPickItemWithData } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { ConfigurationSection, SelectedSubscriptionsConfigurationKey } from '../../constants';
import { IAzureListingSource } from '../../services';
import { ICredentialOptionsScope } from '../../utils/CredentialOptionsScope';
import { subscriptionFilterKey } from '../../utils/subscriptionFilter';
import type { ManagedCommand } from '../ManagedCommand';
import { listReachableSubscriptions, type UnreachableAuthNode } from './listReachableAuthNodes';

/**
 * Prompts the user to select which subscriptions should be visible in the
 * Azure resources tree and updates `vscode-azure.selectedSubscriptions`.
 *
 * Subscription discovery runs under a silent {@linkcode ICredentialOptionsScope}
 * (`{ sessionOptions: { silent: true } }`): accounts/tenants that cannot mint a
 * token without interactive sign-in are skipped and surfaced as a non-blocking
 * warning (see {@linkcode listReachableSubscriptions}) rather than aborting the
 * whole command, so the user can still filter the subscriptions that did load.
 *
 * Discovery reads the *unfiltered* listing rather than the resources tree. The
 * tree applies the very filter this command edits, so sourcing the pick list
 * from it would let the user narrow the filter but never widen it again.
 */
@injectable()
export class SelectSubscriptions implements ManagedCommand {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IAzureListingSource) private readonly listing: IAzureListingSource,
        @inject(ICredentialOptionsScope) private readonly credentialOptions: ICredentialOptionsScope,
        @inject(IActionContext) private readonly actionContext: IActionContext,
    ) { }

    /** @inheritdoc */
    public async execute(): Promise<void> {
        const code = this.ctx.code;
        const config = code.workspace.getConfiguration(ConfigurationSection);
        const currentSelected = config.get<string[]>(SelectedSubscriptionsConfigurationKey, []);
        const currentSet = new Set(currentSelected.map(id => id.toLowerCase()));

        // Discover subscriptions silently: any credential built during the walk
        // (including cache misses) acquires its token without prompting, so an
        // un-authable tenant fails fast instead of interrupting the user.
        const { subscriptions: reachable, failures } = await this.credentialOptions.run(
            { sessionOptions: { silent: true } },
            () => listReachableSubscriptions(this.listing),
        );

        if (failures.length > 0) {
            this.reportFailures(failures);
        }

        if (reachable.length === 0) {
            // Both messages are user-actionable ("sign in"), not bugs, so show
            // the toast but omit the "Report Issue" button.
            this.actionContext.errorHandling.suppress = 'reportIssue';
            if (failures.length > 0) {
                throw new Error(code.l10n.t('Could not load subscriptions for any tenant. Sign in to those tenants and try again.'));
            }
            throw new Error(code.l10n.t('No reachable subscriptions were found. Sign in to Azure and try again.'));
        }

        const picks: QuickPickItemWithData<AzureSubscription>[] = reachable.map(({ account, tenant, subscription }) => {
            return {
                label: code.l10n.t('{0} ({1})', subscription.displayName, subscription.subscriptionId),
                description: code.l10n.t('Tenant: {0}', tenant.displayName),
                detail: code.l10n.t('Tenant ID: {0} | Account: {1}', tenant.tenantId, account.label),
                data: subscription,
            };
        });

        const selected = await showSmartQuickPick(this.ctx, picks, {
            canPickMany: true,
            placeHolder: code.l10n.t('Select subscriptions to include in the Azure resources view'),
            isSelectedItem: item => currentSet.size === 0 || currentSet.has(subscriptionFilterKey(item.data.tenantId, item.data.subscriptionId)),
        });

        const selectedIds = [...new Set(selected.map(item => subscriptionFilterKey(item.data.tenantId, item.data.subscriptionId)))]
            .sort((a, b) => a.localeCompare(b));

        // Persisting an empty list means "no filtering" (show everything). Only
        // collapse to that when every reachable subscription was selected AND
        // nothing failed to load: if some tenants failed, an empty list would
        // also unhide the subscriptions we could not enumerate, so persist the
        // explicit id list instead.
        const nextValue = failures.length === 0 && selectedIds.length === picks.length ? [] : selectedIds;

        // The config is watched by the Azure view, so it will refresh automatically after this update.
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
            this.executor.output.warn(code.l10n.t('[selectSubscriptions] could not list subscriptions for tenant={0} account={1}: {2}', failure.tenant?.tenantId ?? '<all>', failure.account.id, stringifyError(failure.error)));
        }

        const tenantNames = failures
            .map(failure => failure.tenant?.displayName)
            .filter((name): name is string => !!name);
        const detail = [...new Set(tenantNames)].join(', ');

        void showMessage(
            code,
            detail
                ? code.l10n.t('Some tenants could not be loaded and may be missing from this list: {0}. Sign in to those tenants to include their subscriptions.', detail)
                : code.l10n.t('Some tenants could not be loaded and may be missing from this list. Sign in to those tenants to include their subscriptions.'),
            { severity: 'warning' },
        );
    }
}
