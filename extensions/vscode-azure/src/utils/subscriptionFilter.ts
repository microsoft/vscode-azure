/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Owns the format of the `vscode-azure.selectedSubscriptions` filter entries: a
 * `tenantId/subscriptionId` pair with both halves lowercased. Keeping the build
 * and parse sides in one place ensures the values written by the Select
 * Subscriptions command always round-trip with the filtering done by the view
 * provider (change the separator or casing here and both directions stay in
 * sync).
 */

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
 * Determine whether a tenant is included by the selected-subscriptions filter.
 *
 * An empty filter selects every tenant. Otherwise, a tenant is selected when at
 * least one configured subscription belongs to it.
 */
export function isTenantSelected(selectedSubscriptions: readonly string[], tenantId: string): boolean {
    if (selectedSubscriptions.length === 0) {
        return true;
    }

    const normalizedTenantId = tenantId.toLowerCase();
    return selectedSubscriptions.some(entry => parseSubscriptionFilterKey(entry).tenantId === normalizedTenantId);
}
