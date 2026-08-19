/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureAccount, AzureSubscription, AzureTenant, IAzureListingSource } from '@microsoft/vscode-azure-azutils';
import { isSubscription, isTenant } from '@microsoft/vscode-azure-azutils';
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
 * An account or tenant whose subscriptions could not be enumerated during
 * silent discovery -- typically because a token could not be obtained without
 * interactive sign-in (e.g. the tenant requires additional MFA / conditional
 * access). Recorded so the caller can surface it instead of aborting the whole
 * operation on the first un-authable tenant.
 */
export interface UnreachableAuthNode {
    readonly account: AzureAccount;
    /** The tenant that failed, or `undefined` when the account's tenant list itself failed. */
    readonly tenant?: AzureTenant;
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
 * Accounts can belong to a very large number of tenants (hundreds), so this
 * deliberately reads only the first page of each account's tenants. The result
 * is intended to seed a combobox where the user can either pick a suggested
 * tenant or type any tenant ID directly, so an exhaustive list is neither
 * needed nor desirable.
 *
 * Reads the *unfiltered* listing: this seeds a sign-in flow, whose whole
 * purpose is to reach a tenant the tree does not currently show.
 */
export async function listFirstPageReachableTenants(listing: IAzureListingSource): Promise<ReachableTenant[]> {
    const tenants = new Map<string, ReachableTenant>();

    for (const account of await listing.listAccounts()) {
        // First page only -- the loop breaks after the first iteration.
        for await (const page of listing.listTenantsForAccount(account)) {
            for (const tenantNode of page.items) {
                if (!isTenant(tenantNode)) {
                    continue;
                }

                const key = `${account.id.toLowerCase()}/${tenantNode.tenantId.toLowerCase()}`;
                if (!tenants.has(key)) {
                    tenants.set(key, { account, tenant: tenantNode });
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
 * Enumerate every subscription reachable from the currently signed-in accounts,
 * walking account -> tenant -> subscription.
 *
 * Reads the *unfiltered* listing, bypassing the shared tree cache. This backs
 * the Select Subscriptions pick list, which must show subscriptions the current
 * filter excludes -- otherwise the filter could only ever be narrowed, never
 * widened. Nothing enumerated here enters the tree cache, so a filtered-out
 * tenant surfaced for the pick list cannot leak into the resources view.
 *
 * This function only walks and isolates faults; it does *not* establish any
 * credential options itself. Callers that need silent acquisition (e.g. Select
 * Subscriptions) should run it inside an {@linkcode ICredentialOptionsScope}
 * requesting `{ sessionOptions: { silent: true } }`, so that acquiring a
 * credential fetches silently rather than prompting interactive sign-in.
 *
 * Discovery is best-effort and fault-isolated: a failure enumerating one
 * account's tenants, or one tenant's subscriptions, is captured in
 * {@linkcode ReachableSubscriptionsResult.failures} and does not abort the rest.
 * This matters because a single tenant that cannot mint a token (silently or
 * otherwise) would otherwise reject the whole walk and prevent the user from
 * selecting *any* subscription.
 *
 * @param listing - The unfiltered account/tenant/subscription listing.
 * @returns The reachable subscriptions (deduped and sorted) and any failures.
 */
export async function listReachableSubscriptions(listing: IAzureListingSource): Promise<ReachableSubscriptionsResult> {
    const subscriptions = new Map<string, ReachableSubscription>();
    const failures: UnreachableAuthNode[] = [];

    for (const account of await listing.listAccounts()) {
        try {
            for await (const tenantPage of listing.listTenantsForAccount(account)) {
                for (const tenantNode of tenantPage.items) {
                    if (!isTenant(tenantNode)) {
                        continue;
                    }

                    try {
                        for await (const subscriptionPage of listing.listSubscriptionsForTenant(tenantNode)) {
                            for (const subscriptionNode of subscriptionPage.items) {
                                if (!isSubscription(subscriptionNode)) {
                                    continue;
                                }

                                const key = subscriptionFilterKey(tenantNode.tenantId, subscriptionNode.subscriptionId);
                                if (!subscriptions.has(key)) {
                                    subscriptions.set(key, {
                                        account,
                                        tenant: tenantNode,
                                        subscription: subscriptionNode,
                                    });
                                }
                            }
                        }
                    } catch (error) {
                        // One tenant could not be enumerated (e.g. token acquisition
                        // needs interactive sign-in under a silent scope). Record and
                        // continue so other tenants/accounts still contribute their
                        // subscriptions.
                        failures.push({ account, tenant: tenantNode, error });
                    }
                }
            }
        } catch (error) {
            // The account's tenant list itself failed; record and move on.
            failures.push({ account, error });
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
