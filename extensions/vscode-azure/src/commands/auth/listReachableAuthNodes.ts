/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureAccount, AzureListingCache, AzureSubscription, AzureTenant } from '@microsoft/vscode-azure-azutils';
import { DiscoveryConcurrency, isNotSignedInError } from '@microsoft/vscode-azure-azutils';
import { CaselessMap } from '@microsoft/vscode-azure-utils';
import { subscriptionFilterKey } from '../../utils/subscriptionFilter';

/**
 * A tenant that is reachable from a signed-in account.
 */
export interface ReachableTenant {
    readonly account: AzureAccount;
    readonly tenant: AzureTenant;
}

/**
 * A subscription that is reachable from a signed-in account/tenant pair.
 */
export interface ReachableSubscription {
    readonly account: AzureAccount;
    readonly tenant: AzureTenant;
    readonly subscription: AzureSubscription;
}

/**
 * Why an account or tenant did not take part in a discovery walk.
 *
 * `notSignedIn` is the expected outcome, not a fault: an account with access to
 * many tenants has usually signed in to only some of them, and the rest are
 * reachable the moment the user signs in. `error` is everything else -- a
 * network failure, a service error, a policy denial that signing in will not
 * fix.
 */
export type UnreachableReason = 'notSignedIn' | 'error';

/**
 * An account or tenant whose subscriptions could not be enumerated during
 * silent discovery. Recorded so the caller can surface it instead of aborting
 * the whole operation on the first tenant it cannot reach.
 */
export interface UnreachableAuthNode {
    readonly account: AzureAccount;
    /** The tenant that failed, or `undefined` when the account's tenant list itself failed. */
    readonly tenant?: AzureTenant;
    readonly reason: UnreachableReason;
    readonly error: unknown;
}

/**
 * The outcome of {@linkcode listReachableSubscriptions}: the subscriptions that
 * were enumerated silently, plus any accounts/tenants that failed along the way.
 */
export interface ReachableSubscriptionsResult {
    readonly subscriptions: ReachableSubscription[];
    readonly failures: UnreachableAuthNode[];
}

/**
 * Enumerate the first page of reachable tenants across all signed-in accounts.
 *
 * An account can have access to a very large number of tenants (hundreds), so
 * this deliberately reads only the first page of each account's tenants. The
 * result is intended to seed a combobox where the user can either pick a
 * suggested tenant or type any tenant ID directly, so an exhaustive list is
 * neither needed nor desirable.
 *
 * Read **unfiltered**: this feeds a flow that decides which tenants to sign in
 * to, and a list narrowed by the current filter could only ever narrow it
 * further.
 */
export async function listFirstPageReachableTenants(listings: AzureListingCache): Promise<ReachableTenant[]> {
    const tenants = new CaselessMap<ReachableTenant>();

    for (const account of await listings.listAccounts()) {
        // First page only -- the loop breaks rather than draining the listing,
        // so later pages are never pulled.
        for await (const page of listings.listTenants(account)) {
            for (const tenant of page.items) {
                const key = `${account.id}/${tenant.tenantId}`;
                if (!tenants.has(key)) {
                    tenants.set(key, { account, tenant });
                }
            }
            break;
        }
    }

    return [...tenants.values()].sort((a, b) => {
        return a.tenant.displayName.localeCompare(b.tenant.displayName)
            || a.tenant.tenantId.localeCompare(b.tenant.tenantId)
            || a.account.label.localeCompare(b.account.label);
    });
}

/**
 * Enumerate every subscription reachable from the currently signed-in accounts.
 *
 * Read **unfiltered**, which is the whole point: this feeds the command that
 * *edits* the filter, so reading through the filter would leave the user able to
 * narrow their selection but never widen it again. Everything fetched here is
 * cached all the same, so the tree's next filtered read pays for none of it --
 * and equally, tenants the tree already loaded are not listed a second time.
 *
 * This function only walks and isolates faults; it does *not* establish any
 * credential options itself. Callers that need silent acquisition (e.g. Select
 * Subscriptions) should run it inside an {@linkcode ICredentialOptionsScope}
 * requesting `{ sessionOptions: { silent: true } }`, so that any cache *miss*
 * fetches a credential silently rather than prompting interactive sign-in.
 *
 * Discovery is best-effort and fault-isolated: a failure enumerating one
 * account's tenants, or one tenant's subscriptions, is captured in
 * {@linkcode ReachableSubscriptionsResult.failures} and does not abort the rest.
 * This matters because a single tenant that cannot mint a token (silently or
 * otherwise) would otherwise reject the whole walk and prevent the user from
 * selecting *any* subscription. Each failure carries an
 * {@linkcode UnreachableReason} so a caller can tell the routine case -- a
 * tenant nobody has signed in to -- from a real fault.
 *
 * Tenants are listed a few at a time, because this consumer drains the walk in
 * full: every tenant's listing is going to be paid for, and each is a token
 * request plus a round trip with no ordering dependency on any other.
 *
 * @param listings - The listing cache to walk.
 * @returns The reachable subscriptions (deduped and sorted) and any failures.
 */
export async function listReachableSubscriptions(listings: AzureListingCache): Promise<ReachableSubscriptionsResult> {
    const subscriptions = new CaselessMap<ReachableSubscription>();
    const failures: UnreachableAuthNode[] = [];

    const walk = listings.walkSubscriptions({
        concurrency: DiscoveryConcurrency,
        onFailure: failure => failures.push({
            account: failure.account,
            tenant: failure.tenant,
            reason: isNotSignedInError(failure.error) ? 'notSignedIn' : 'error',
            error: failure.error,
        }),
    });

    for await (const { account, tenant, subscription } of walk) {
        const key = subscriptionFilterKey(tenant.tenantId, subscription.subscriptionId);
        // The key is tenant-scoped, so one subscription reachable through two
        // tenants is two entries and both survive. This only collides when two
        // signed-in accounts reach the same subscription through the *same*
        // tenant, and then first-wins picks the account. That is deterministic
        // only because the walk yields in source order regardless of how many
        // tenants it lists at once.
        if (!subscriptions.has(key)) {
            subscriptions.set(key, { account, tenant, subscription });
        }
    }

    const sorted = [...subscriptions.values()].sort((a, b) => {
        return a.subscription.displayName.localeCompare(b.subscription.displayName)
            || a.subscription.subscriptionId.localeCompare(b.subscription.subscriptionId)
            || a.tenant.tenantId.localeCompare(b.tenant.tenantId)
            || a.account.label.localeCompare(b.account.label);
    });

    return { subscriptions: sorted, failures };
}
