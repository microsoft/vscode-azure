/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Owns the format of the `vscode-azure.selectedSubscriptions` filter entries: a
 * `tenantId/subscriptionId` pair with both halves lowercased. Keeping the build
 * and parse sides in one place ensures the values written by the Select
 * Subscriptions command always round-trip with the filtering done by the data
 * provider (change the separator or casing here and both directions stay in
 * sync).
 */

import type { IVsCode } from '@microsoft/vscode-azure-utils';
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
 * The active tenant/subscription filter, expressed as the two sets the data
 * provider tests against. Both sets hold lowercased ids.
 *
 * A tenant is admitted when its id appears in {@linkcode SubscriptionFilter.tenantIds},
 * which lets the provider drop a tenant *before* minting a tenant-scoped token
 * for it. A subscription is admitted when its id appears in
 * {@linkcode SubscriptionFilter.subscriptionIds}.
 */
export interface SubscriptionFilter {
    readonly tenantIds: ReadonlySet<string>;
    readonly subscriptionIds: ReadonlySet<string>;
}

/**
 * Read the active filter from `vscode-azure.selectedSubscriptions`.
 *
 * @returns The parsed filter, or `undefined` when the setting is empty --
 * which means "no filtering", and is deliberately distinct from a filter whose
 * sets are empty (that would admit nothing).
 */
export function readSubscriptionFilter(code: IVsCode): SubscriptionFilter | undefined {
    const selected = code.workspace
        .getConfiguration(ConfigurationSection)
        .get<string[]>(SelectedSubscriptionsConfigurationKey, []);

    if (!Array.isArray(selected) || selected.length === 0) {
        return undefined;
    }

    const parsed = selected.map(parseSubscriptionFilterKey);
    return {
        tenantIds: new Set(parsed.map(entry => entry.tenantId).filter((id): id is string => !!id)),
        subscriptionIds: new Set(parsed.map(entry => entry.subscriptionId).filter((id): id is string => !!id)),
    };
}
