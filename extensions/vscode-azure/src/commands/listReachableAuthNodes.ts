/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureAccount, AzureSubscription, AzureTenant, ConcreteAzureNodeTree } from '@microsoft/vscode-azure-azutils';
import { isAccount, isSubscription, isTenant } from '@microsoft/vscode-azure-azutils';
import { drillChildren } from '@microsoft/vscode-azure-utils';
import { subscriptionFilterKey } from '../utils/subscriptionFilter';

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
 * Enumerate every subscription reachable from the currently signed-in accounts,
 * drilling account -> tenant -> subscription via the shared tree cache (so
 * results already loaded for the tree are reused).
 *
 * This function only drills and isolates faults; it does *not* establish any
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
 * selecting *any* subscription.
 *
 * @param tree - The Azure resources data tree (cache) to drill.
 * @returns The reachable subscriptions (deduped and sorted) and any failures.
 */
export async function listReachableSubscriptions(tree: ConcreteAzureNodeTree): Promise<ReachableSubscriptionsResult> {
    const subscriptions = new Map<string, ReachableSubscription>();
    const failures: UnreachableAuthNode[] = [];

    for await (const accountNode of drillChildren(tree, undefined)) {
        if (!isAccount(accountNode)) {
            continue;
        }

        try {
            for await (const tenantNode of drillChildren(tree, accountNode)) {
                if (!isTenant(tenantNode)) {
                    continue;
                }

                try {
                    for await (const subscriptionNode of drillChildren(tree, tenantNode)) {
                        if (!isSubscription(subscriptionNode)) {
                            continue;
                        }

                        const key = subscriptionFilterKey(tenantNode.tenantId, subscriptionNode.subscriptionId);
                        if (!subscriptions.has(key)) {
                            subscriptions.set(key, {
                                account: accountNode,
                                tenant: tenantNode,
                                subscription: subscriptionNode,
                            });
                        }
                    }
                } catch (error) {
                    // One tenant could not be enumerated (e.g. token acquisition
                    // needs interactive sign-in under a silent scope). Record and
                    // continue so other tenants/accounts still contribute their
                    // subscriptions.
                    failures.push({ account: accountNode, tenant: tenantNode, error });
                }
            }
        } catch (error) {
            // The account's tenant list itself failed; record and move on.
            failures.push({ account: accountNode, error });
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
