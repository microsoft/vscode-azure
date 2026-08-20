/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { stringifyError, type IActionExecutor, type ICodeContext, type Page } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import { SubscriptionClient } from '../../rest/clients/SubscriptionClient';
import type { AzureAccount, AzureSubscription, AzureTenant } from '../AzureSubscription';
import type { ICredentialFactory } from '../CredentialFactory';
import { getAuthProviderId, getConfiguredAzureEnv } from '../Environment';
import { NotSignedInError } from '../NotSignedInError';

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
     * A listing that fails outright yields an empty terminal page rather than
     * throwing. Conditional access blocks this call for exactly the accounts
     * whose tenants the user has to name by hand, and those named tenants are
     * merged in above this layer -- so failing here would take out the fallback
     * along with the thing it is a fallback for. Retrying is not attempted
     * either: the failure is usually policy rather than transience, and the
     * retry would be the interactive prompt the user is trying to avoid.
     */
    public async *fetchTenants(account: AzureAccount): AsyncIterable<Page<AzureTenant>> {
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
                yield { items, hasMore: page.hasMore };
            }
        } catch (error) {
            this.executor.output.warn(this.ctx.code.l10n.t('[listing] listing tenants failed; only manually-entered tenants will be reachable for this account: {0}', stringifyError(error)));
            yield { items: [], hasMore: false };
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
     *
     * @throws {@linkcode NotSignedInError} when no token can be obtained for the
     * tenant. The token is acquired up front rather than left to the client's
     * bearer policy, which on a missing token would send the request
     * unauthenticated and surface a 401 -- indistinguishable from a real fault.
     * A tenant the user has never signed in to is the *expected* case during a
     * walk, so it has to be reported as itself.
     *
     * The probe is pinned silent rather than inheriting the ambient credential
     * scope, so this can only ever answer "is there already a session" -- a
     * caller that forgot to establish a silent scope gets `NotSignedInError`
     * instead of an interactive prompt raised by an enumeration it did not ask
     * to be interactive. Listing the subscriptions is still done with an
     * unpinned credential, so a real fetch prompts exactly as the caller
     * intended.
     */
    public async *fetchSubscriptions(tenant: AzureTenant): AsyncIterable<Page<AzureSubscription>> {
        const account = { id: tenant.accountId, label: '' };
        const credential = this.credentialFactory({ tenantId: tenant.tenantId, sessionOptions: { account } });

        // Scopes are left empty so the credential applies the environment's own
        // resource-manager default -- the same scope the client below requests,
        // so this resolves the session the request would have used rather than
        // establishing a second one. `createIfNone` is pinned off as well as
        // `silent` on, because the two are mutually exclusive to VS Code and an
        // ambient scope could otherwise supply the former.
        const probe = this.credentialFactory({
            tenantId: tenant.tenantId,
            sessionOptions: { account, silent: true, createIfNone: false },
        });
        if (!await probe.getToken([], { tenantId: tenant.tenantId })) {
            throw new NotSignedInError(`No session is available for tenant ${tenant.tenantId}`);
        }

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
}
