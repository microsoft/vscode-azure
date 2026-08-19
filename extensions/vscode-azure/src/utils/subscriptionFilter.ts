/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Owns the format of the `vscode-azure.selectedSubscriptions` filter entries: a
 * `tenantId/subscriptionId` pair with both halves lowercased. Keeping the build
 * and parse sides in one place ensures the values written by the Select
 * Subscriptions command always round-trip with the filtering applied while the
 * tree walks the listing cache (change the separator or casing here and both
 * directions stay in sync).
 */

import { isSubscription, isTenant, type AzureListingFilter } from '@microsoft/vscode-azure-azutils';
import { CaselessSet, type IVsCode } from '@microsoft/vscode-azure-utils';
import { ConfigurationSection, SelectedSubscriptionsConfigurationKey } from '../constants';

/** The separator between the tenant id and subscription id in a filter key. */
const separator = '/';

/**
 * Build a `selectedSubscriptions` filter key from a tenant/subscription id pair.
 * Both halves are lowercased so the config round-trip and all lookups are
 * case-insensitive.
 *
 * @param tenantId - The subscription's tenant id.
 * @param subscriptionId - The subscription id.
 * @returns The lowercased `tenantId/subscriptionId` key.
 */
export function subscriptionFilterKey(tenantId: string, subscriptionId: string): string {
    return `${tenantId.toLowerCase()}${separator}${subscriptionId.toLowerCase()}`;
}

/**
 * Parse a `selectedSubscriptions` filter key into its two (already lowercased)
 * halves. Tolerant of malformed entries: a missing half yields `undefined` for
 * that field so callers can filter it out.
 *
 * @param key - A `tenantId/subscriptionId` key as produced by {@linkcode subscriptionFilterKey}.
 * @returns The lowercased `tenantId` and `subscriptionId`, either of which may be `undefined`.
 */
export function parseSubscriptionFilterKey(key: string): { readonly tenantId?: string; readonly subscriptionId?: string } {
    const [tenantId, subscriptionId] = key.toLowerCase().split(separator);
    return { tenantId: tenantId || undefined, subscriptionId: subscriptionId || undefined };
}

/**
 * Build the {@linkcode AzureListingFilter} described by
 * `vscode-azure.selectedSubscriptions`, or `undefined` when the setting is
 * empty.
 *
 * An empty setting means "no filtering", not "admit nothing" -- conflating the
 * two shows an empty tree. Returning `undefined` (rather than a predicate that
 * happens to admit everything) keeps that distinction impossible to get wrong at
 * a call site, since the unfiltered read is spelled the same way as the
 * no-filter-configured one.
 *
 * A tenant is admitted when the filter names it at all; a subscription only when
 * the filter names the exact `tenantId/subscriptionId` pair, because the same
 * subscription reached through two tenants is two distinct nodes and the user
 * may well have selected only one of them. Accounts are always admitted: the
 * setting says nothing about them.
 *
 * @param code - Used to read the configuration.
 */
export function createSubscriptionFilter(code: IVsCode): AzureListingFilter | undefined {
    const selected = code.workspace
        .getConfiguration(ConfigurationSection)
        .get<string[]>(SelectedSubscriptionsConfigurationKey, []);

    if (selected.length === 0) {
        return undefined;
    }

    const parsed = selected.map(parseSubscriptionFilterKey);
    const tenants = new CaselessSet(parsed.map(entry => entry.tenantId).filter(id => id !== undefined));
    const pairs = new CaselessSet(parsed.flatMap(entry =>
        entry.tenantId !== undefined && entry.subscriptionId !== undefined
            ? [subscriptionFilterKey(entry.tenantId, entry.subscriptionId)]
            : []));

    return node => {
        if (isSubscription(node)) {
            return pairs.has(subscriptionFilterKey(node.tenantId, node.subscriptionId));
        } else if (isTenant(node)) {
            return tenants.has(node.tenantId);
        } else {
            return true;
        }
    };
}
