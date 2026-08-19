/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    getAuthProviderId, getConfiguredAzureEnv,
    ICredentialFactory,
    SubscriptionClient,
    type AzureAccount, type AzureSubscription, type AzureTenant,
    type ConcreteAzureNode, type IAzureListingSource,
} from '@microsoft/vscode-azure-azutils';
import { IActionExecutor, ICodeContext, stringifyError, type Page } from '@microsoft/vscode-azure-utils';
import { inject, injectable, unmanaged, type ServiceIdentifier } from 'inversify';
import { readSignedInTenants } from '../../utils/signedInTenants';

/** Identifier for the raw (uncached, unfiltered) Azure listing source. */
export const IAzureAccountListingSource: ServiceIdentifier<AzureAccountListingSource> = Symbol.for('IAzureAccountListingSource');

/**
 * How long (ms) after a `getAccounts()` call resolves to keep ignoring
 * `onDidChangeSessions`. The call can itself trigger a session-change event, so
 * treating events in a short window around the call as self-induced breaks that
 * feedback loop.
 */
const GetAccountsSuppressionMs = 1000;

/**
 * Fetches the raw account/tenant/subscription listings from the VS Code
 * authentication API and ARM.
 *
 * Every method here goes to the network (or the auth provider) on each call:
 * caching is layered on top by {@linkcode AzureListingCache}, and the
 * `vscode-azure.selectedSubscriptions` filter is applied above that by the tree.
 * This class only knows how to fetch the truth.
 */
@injectable()
export class AzureAccountListingSource implements IAzureListingSource {
    /**
     * Count of in-flight {@linkcode listAccounts} calls. While greater than
     * zero, incoming `onDidChangeSessions` events are treated as potentially
     * self-induced. A counter (rather than a boolean) tolerates overlapping
     * calls. See {@linkcode suppressSessionEventsUntil} for the trailing window
     * that covers events arriving just after the call resolves.
     */
    private getAccountsInFlight = 0;

    /**
     * Timestamp (epoch ms) before which incoming `onDidChangeSessions` events
     * are self-induced. Armed after our own `getAccounts()` call resolves. See
     * {@linkcode GetAccountsSuppressionMs}.
     */
    private suppressSessionEventsUntil = 0;

    private lastSeenAccountIds: ReadonlySet<string> | undefined;

    /**
     * @param now - Clock used to arm the session-suppression window. Injectable
     * so tests can drive it deterministically.
     */
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(ICredentialFactory) private readonly credentialFactory: ICredentialFactory,
        @unmanaged() private readonly now: () => number = Date.now,
    ) { }

    /**
     * The set of account ids ({@linkcode AzureAccount.id}, lowercased) seen by
     * the most recent {@linkcode listAccounts} call, or `undefined` if accounts
     * have never been listed.
     *
     * Lets a caller decide whether an `onDidChangeSessions` burst actually added
     * or removed an account. It is updated by *every* listing, including those
     * driven by the tree, so a session event arriving after the tree has loaded
     * compares against what the user can already see.
     */
    public get knownAccountIds(): ReadonlySet<string> | undefined {
        return this.lastSeenAccountIds;
    }

    /**
     * Whether an incoming `onDidChangeSessions` event should be treated as
     * self-induced by our own `getAccounts()` call, and therefore ignored.
     *
     * Calling `getAccounts()` can itself raise `onDidChangeSessions`, which would
     * otherwise re-enter and loop. True while such a call is in flight (however
     * long it takes) and for a short window afterwards.
     */
    public isSuppressingSessionEvents(): boolean {
        return this.getAccountsInFlight > 0 || this.now() < this.suppressSessionEventsUntil;
    }

    /**
     * @inheritdoc
     *
     * Reads the configured environment via {@linkcode getConfiguredAzureEnv} and
     * attaches it to each account. Also records {@linkcode knownAccountIds} and
     * arms the session-event suppression window.
     *
     * @returns The signed-in accounts, sorted by label.
     */
    public async listAccounts(): Promise<AzureAccount[]> {
        const environment = getConfiguredAzureEnv(this.ctx.code);

        // Suppress session-change events around our own getAccounts() call: the
        // call can itself trigger onDidChangeSessions, which would otherwise
        // re-enter and loop. The in-flight counter covers the call no matter how
        // long it takes; the trailing timestamp (armed in finally, so a thrown
        // call still leaves a guarded tail) covers any event that arrives just
        // after the call resolves.
        this.getAccountsInFlight++;
        let accounts;
        try {
            accounts = await this.ctx.code.authentication.getAccounts(getAuthProviderId(environment));
        } finally {
            this.suppressSessionEventsUntil = this.now() + GetAccountsSuppressionMs;
            this.getAccountsInFlight--;
        }

        const result = accounts
            .map(account => ({
                ...account,
                environment,
            } satisfies AzureAccount))
            .sort((a, b) => a.label.localeCompare(b.label));

        this.lastSeenAccountIds = new Set(result.map(account => account.id.toLowerCase()));

        return result;
    }

    /**
     * @inheritdoc
     *
     * Accounts can belong to a very large number of tenants, so pages are
     * streamed lazily rather than buffered; ordering follows the service
     * response (no cross-page sort).
     *
     * Tenants the user signed in to by manually entering a tenant id (persisted
     * via {@linkcode readSignedInTenants}) are merged into the listing so the
     * tree can reach them even when listing tenants is blocked outright (e.g.
     * conditional access). They are appended to the final page (or, if the
     * listing itself fails, become the only page), and deduplicated against the
     * listed tenants so a tenant that is both listed and saved keeps its real
     * display name rather than the bare id stand-in.
     *
     * @param account - The account whose tenants are listed.
     */
    public async *listTenantsForAccount(account: AzureAccount): AsyncIterable<Page<ConcreteAzureNode>> {
        const manualTenants = this.manualTenantsForAccount(account);
        const seen = new Set<string>();
        let emittedTerminalPage = false;

        const credential = this.credentialFactory({ sessionOptions: { account } });
        const client = SubscriptionClient.create(this.ctx, this.executor, credential, account.environment, undefined, { accountId: account.id });
        try {
            for await (const page of client.tenants.list()) {
                const items = page.items
                    .filter((tenant): tenant is typeof tenant & { tenantId: string; displayName: string } => !!tenant.tenantId && !!tenant.displayName)
                    .map(tenant => ({
                        ...tenant,
                        tenantId: tenant.tenantId.toLowerCase(),
                        environment: account.environment,
                        accountId: account.id,
                    } satisfies AzureTenant));
                items.forEach(tenant => seen.add(tenant.tenantId));

                if (page.hasMore) {
                    yield { items, hasMore: true };
                } else {
                    // Final page: fold in any manual tenants not already listed.
                    const extras = manualTenants.filter(tenant => !seen.has(tenant.tenantId));
                    yield { items: [...items, ...extras], hasMore: false };
                    emittedTerminalPage = true;
                }
            }
        } catch (error) {
            // Listing tenants can fail outright (e.g. conditional access). Fall
            // back to the manually-entered tenants below rather than surfacing an
            // error: a tenant-scoped sign-in still works, so those tenants are
            // reachable even though they can't be enumerated.
            this.executor.output.warn(this.ctx.code.l10n.t('[auth] listing tenants failed; falling back to {0} manually-entered tenant(s): {1}', manualTenants.length, stringifyError(error)));
        }

        if (!emittedTerminalPage) {
            // The listing failed, or yielded nothing, so emit the manual tenants
            // as the terminal page (deduped against anything already streamed).
            const extras = manualTenants.filter(tenant => !seen.has(tenant.tenantId));
            yield { items: extras, hasMore: false };
        }
    }

    /**
     * @inheritdoc
     *
     * A tenant can contain a very large number of subscriptions, so pages are
     * streamed lazily rather than buffered; ordering follows the service
     * response (no cross-page sort).
     *
     * @param tenant - The tenant whose subscriptions are listed.
     */
    public async *listSubscriptionsForTenant(tenant: AzureTenant): AsyncIterable<Page<ConcreteAzureNode>> {
        const credential = this.credentialFactory({ tenantId: tenant.tenantId, sessionOptions: { account: { id: tenant.accountId, label: '' } } });
        const client = SubscriptionClient.create(this.ctx, this.executor, credential, tenant.environment, undefined, tenant);
        for await (const page of client.subscriptions.list()) {
            const items = page.items
                .filter((sub): sub is typeof sub & { subscriptionId: string; tenantId: string; displayName: string } => !!sub.subscriptionId && !!sub.tenantId && !!sub.displayName)
                .map(sub => ({
                    ...sub,
                    subscriptionId: sub.subscriptionId.toLowerCase(),
                    tenantId: sub.tenantId.toLowerCase(),
                    environment: tenant.environment,
                    accountId: tenant.accountId,
                } satisfies AzureSubscription));
            yield { items, hasMore: page.hasMore };
        }
    }

    /**
     * Build synthesized {@linkcode AzureTenant}s for the manually-entered
     * tenants saved for the given account. No display name is available (listing
     * is what's blocked), so the tenant id is used as the label stand-in.
     *
     * The persisted setting is user-editable, so it can contain duplicate tenant
     * ids (differing only in casing); they are deduplicated here so a tenant is
     * never surfaced more than once for the same account.
     */
    private manualTenantsForAccount(account: AzureAccount): AzureTenant[] {
        const seen = new Set<string>();
        const tenants: AzureTenant[] = [];
        const accountId = account.id.toLowerCase();
        for (const entry of readSignedInTenants(this.ctx.code)) {
            // Match account ids case-insensitively (matching the `byAccount`
            // selector): the persisted id is written verbatim from
            // `session.account.id` and this setting is user-editable, so a casing
            // difference must not prevent a saved tenant from being folded into
            // its account's listing.
            if (entry.accountId.toLowerCase() !== accountId) {
                continue;
            }
            const tenantId = entry.tenantId.toLowerCase();
            if (seen.has(tenantId)) {
                continue;
            }
            seen.add(tenantId);
            tenants.push({
                tenantId,
                displayName: entry.tenantId,
                environment: account.environment,
                accountId: account.id,
            } satisfies AzureTenant);
        }
        return tenants;
    }
}
