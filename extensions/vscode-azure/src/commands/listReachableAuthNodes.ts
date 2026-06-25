/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureAccount, AzureSubscription, AzureTenant, ConcreteAzureNodeTree } from '@microsoft/vscode-azure-azutils';
import { isAccount, isSubscription, isTenant } from '@microsoft/vscode-azure-azutils';
import { drillChildren } from '@microsoft/vscode-azure-utils';

/**
 * A subscription that is reachable from a signed-in account/tenant pair.
 */
export interface ReachableSubscription {
    readonly account: AzureAccount;
    readonly tenant: AzureTenant;
    readonly subscription: AzureSubscription;
}
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
