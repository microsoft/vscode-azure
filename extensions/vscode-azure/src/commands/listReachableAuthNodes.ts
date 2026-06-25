/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureAccount, AzureSubscription, AzureTenant, ConcreteAzureNodeTree } from '@microsoft/vscode-azure-azutils';
import { isAccount, isSubscription, isTenant } from '@microsoft/vscode-azure-azutils';
import { drillChildren } from '@microsoft/vscode-azure-utils';

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
 * Enumerate the first page of reachable tenants across all signed-in accounts.
 *
 * Accounts can belong to a very large number of tenants (hundreds), so this
 * deliberately reads only the first page of each account's tenants -- it never
 * calls {@linkcode ConcreteAzureNodeTree.loadMore} to drain later pages. The
 * result is intended to seed a combobox where the user can either pick a
 * suggested tenant or type any tenant ID directly, so an exhaustive list is
 * neither needed nor desirable.
 */
export async function listFirstPageReachableTenants(tree: ConcreteAzureNodeTree): Promise<ReachableTenant[]> {
    const tenants = new Map<string, ReachableTenant>();

    // Root children (accounts) are not paged, so a single getChildren() call
    // returns them all.
    for (const accountNode of await tree.getChildren()) {
        if (!isAccount(accountNode)) {
            continue;
        }

        // First page only -- intentionally no loadMore() here.
        for (const tenantNode of await tree.getChildren(accountNode)) {
            if (!isTenant(tenantNode)) {
                continue;
            }

            const key = `${accountNode.id.toLowerCase()}/${tenantNode.tenantId.toLowerCase()}`;
            if (!tenants.has(key)) {
                tenants.set(key, { account: accountNode, tenant: tenantNode });
            }
        }
    }

    return [...tenants.values()].sort((a, b) => {
        return a.tenant.displayName.localeCompare(b.tenant.displayName)
            || a.tenant.tenantId.localeCompare(b.tenant.tenantId)
            || a.account.label.localeCompare(b.account.label);
    });
}

/**
 * Enumerate all reachable subscriptions across all signed-in accounts/tenants.
 */
export async function listReachableSubscriptions(tree: ConcreteAzureNodeTree): Promise<ReachableSubscription[]> {
    const subscriptions = new Map<string, ReachableSubscription>();

    for await (const accountNode of drillChildren(tree)) {
        if (!isAccount(accountNode)) {
            continue;
        }

        for await (const tenantNode of drillChildren(tree, accountNode)) {
            if (!isTenant(tenantNode)) {
                continue;
            }

            for await (const subscriptionNode of drillChildren(tree, tenantNode)) {
                if (!isSubscription(subscriptionNode)) {
                    continue;
                }

                const key = `${tenantNode.tenantId.toLowerCase()}/${subscriptionNode.subscriptionId.toLowerCase()}`;
                if (!subscriptions.has(key)) {
                    subscriptions.set(key, {
                        account: accountNode,
                        tenant: tenantNode,
                        subscription: subscriptionNode,
                    });
                }
            }
        }
    }

    return [...subscriptions.values()].sort((a, b) => {
        return a.subscription.displayName.localeCompare(b.subscription.displayName)
            || a.subscription.subscriptionId.localeCompare(b.subscription.subscriptionId)
            || a.tenant.tenantId.localeCompare(b.tenant.tenantId)
            || a.account.label.localeCompare(b.account.label);
    });
}
