/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CaselessSet, stringifyError, type IActionExecutor, type ICodeContext, type Page } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import { SubscriptionClient } from '../../rest/clients/SubscriptionClient';
import type { AzureAccount, AzureSubscription, AzureTenant } from '../AzureSubscription';
import type { ICredentialFactory } from '../CredentialFactory';
import { getAuthProviderId, getConfiguredAzureEnv } from '../Environment';

/**
 * Fetches the account -> tenant -> subscription hierarchy from Azure.
 *
 * Every call issues real work: there is no cache, no memo, and no filtering
 * here. {@linkcode AzureListingCache} is the caching, filterable read surface
 * that consumers inject; this is what it calls on a miss.
 */
export interface IAzureListingFetcher {
    /** List the accounts signed in for the configured environment. */
    fetchAccounts(): Promise<AzureAccount[]>;

    /** List an account's tenants, one page at a time. */
    fetchTenants(account: AzureAccount): AsyncIterable<Page<AzureTenant>>;

    /** List a tenant's subscriptions, one page at a time. */
    fetchSubscriptions(tenant: AzureTenant): AsyncIterable<Page<AzureSubscription>>;
}

/** DI identifier for the {@linkcode IAzureListingFetcher}. */
export const IAzureListingFetcher: ServiceIdentifier<IAzureListingFetcher> = Symbol.for('IAzureListingFetcher');

/** Options for {@linkcode AzureListingFetcher}. */
export interface AzureListingFetcherOptions {
    /**
     * Tenant ids to fold into an account's tenant listing on top of whatever
     * `tenants.list()` returns.
     *
     * Conditional access can block tenant enumeration outright, in which case
     * the only way to reach a tenant is for the user to name it. Where those
     * ids are persisted is a product concern, so the fetcher takes them as a
     * callback rather than reading configuration itself. Synthesized tenants
     * carry the tenant id as their display name until something upgrades it.
     */
    readonly additionalTenantIds?: (account: AzureAccount) => readonly string[];
}

/**
 * The default {@linkcode IAzureListingFetcher}: VS Code's `authentication` API
 * for accounts, and {@linkcode SubscriptionClient} for tenants and
 * subscriptions.
 *
 * Credentials come from an {@linkcode ICredentialFactory}, so callers control
 * interactivity ambiently (e.g. a background walk that wants silent
 * acquisition) without this class taking a position on it.
 */
export class AzureListingFetcher implements IAzureListingFetcher {
    public constructor(
        private readonly ctx: ICodeContext,
        private readonly executor: IActionExecutor,
        private readonly credentialFactory: ICredentialFactory,
        private readonly options?: AzureListingFetcherOptions,
    ) { }

    /**
     * @inheritdoc
     *
     * Lists already-signed-in accounts without prompting: the user is asked to
     * sign in lazily, when an operation actually needs a credential.
     *
     * @returns The signed-in accounts, sorted by label.
     */
    public async fetchAccounts(): Promise<AzureAccount[]> {
        const environment = getConfiguredAzureEnv(this.ctx.code);
        const accounts = await this.ctx.code.authentication.getAccounts(getAuthProviderId(environment));

        return accounts
            .map(account => ({ ...account, environment } satisfies AzureAccount))
            .sort((a, b) => a.label.localeCompare(b.label));
    }

    /**
     * @inheritdoc
     *
     * An account can have access to a very large number of tenants, so pages are
     * streamed lazily rather than buffered; ordering follows the service
     * response (no cross-page sort).
     *
     * Tenants supplied by {@linkcode AzureListingFetcherOptions.additionalTenantIds}
     * are appended to the final page (or become the only page if the listing
     * fails outright), deduplicated against the listed tenants so a tenant that
     * is both listed and named keeps its real display name.
     */
    public async *fetchTenants(account: AzureAccount): AsyncIterable<Page<AzureTenant>> {
        const additional = this.additionalTenants(account);
        const seen = new CaselessSet();
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
                    yield { items: [...items, ...additional.filter(tenant => !seen.has(tenant.tenantId))], hasMore: false };
                    emittedTerminalPage = true;
                }
            }
        } catch (error) {
            // Listing tenants can fail outright (e.g. conditional access). Fall
            // back to the named tenants below rather than surfacing an error: a
            // tenant-scoped sign-in still works, so those tenants are reachable
            // even though they cannot be enumerated.
            this.executor.output.warn(this.ctx.code.l10n.t('[listing] listing tenants failed; falling back to {0} manually-entered tenant(s): {1}', additional.length, stringifyError(error)));
        }

        if (!emittedTerminalPage) {
            yield { items: additional.filter(tenant => !seen.has(tenant.tenantId)), hasMore: false };
        }
    }

    /**
     * @inheritdoc
     *
     * A tenant can contain a very large number of subscriptions, so pages are
     * streamed lazily rather than buffered; ordering follows the service
     * response (no cross-page sort).
     *
     * The subscription's {@linkcode AzureSubscription.tenantId tenantId} is the
     * tenant it was listed through -- the tenant a credential must be scoped to
     * in order to reach it, which is not necessarily the tenant ARM reports as
     * its owner. The same subscription reached through two tenants is therefore
     * two distinct nodes, each authenticating the way it actually has to.
     */
    public async *fetchSubscriptions(tenant: AzureTenant): AsyncIterable<Page<AzureSubscription>> {
        const credential = this.credentialFactory({ tenantId: tenant.tenantId, sessionOptions: { account: { id: tenant.accountId, label: '' } } });
        const client = SubscriptionClient.create(this.ctx, this.executor, credential, tenant.environment, undefined, tenant);
        for await (const page of client.subscriptions.list()) {
            const items = page.items
                .filter((sub): sub is typeof sub & { subscriptionId: string; displayName: string } => !!sub.subscriptionId && !!sub.displayName)
                .map(sub => ({
                    ...sub,
                    subscriptionId: sub.subscriptionId.toLowerCase(),
                    tenantId: tenant.tenantId,
                    environment: tenant.environment,
                    accountId: tenant.accountId,
                } satisfies AzureSubscription));
            yield { items, hasMore: page.hasMore };
        }
    }

    /**
     * Synthesize {@linkcode AzureTenant}s for the tenant ids named for this
     * account. No display name is available (enumeration is what is blocked),
     * so the tenant id stands in until it is upgraded.
     *
     * Ids are deduplicated case-insensitively: they typically come from
     * user-editable storage, so the same tenant can be named twice.
     */
    private additionalTenants(account: AzureAccount): AzureTenant[] {
        const seen = new CaselessSet();
        const tenants: AzureTenant[] = [];
        for (const tenantId of this.options?.additionalTenantIds?.(account) ?? []) {
            if (seen.has(tenantId)) {
                continue;
            }
            seen.add(tenantId);
            tenants.push({
                tenantId: tenantId.toLowerCase(),
                displayName: tenantId,
                environment: account.environment,
                accountId: account.id,
            } satisfies AzureTenant);
        }
        return tenants;
    }
}
