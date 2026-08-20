/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CaselessSet, type Page } from '@microsoft/vscode-azure-utils';
import type { AzureAccount, AzureTenant } from '../AzureSubscription';

/**
 * Synthesize {@linkcode AzureTenant}s for tenant ids named for an account.
 *
 * Conditional access can block tenant enumeration outright, in which case the
 * only way to reach a tenant is for the user to name its id. No display name is
 * available -- enumeration is the very thing that is blocked -- so the id stands
 * in until something upgrades it.
 *
 * Ids are deduplicated case-insensitively, because they typically come from
 * user-editable storage where the same tenant can be named twice.
 */
export function additionalTenantsFor(account: AzureAccount, tenantIds: readonly string[]): AzureTenant[] {
    const seen = new CaselessSet();
    const tenants: AzureTenant[] = [];
    for (const tenantId of tenantIds) {
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

/**
 * Append `additional` to a tenant listing, dropping any that the listing already
 * produced.
 *
 * Applied **above the cache**, over whatever the account listed, rather than
 * folded into the cached listing. That is what makes the named set free to
 * change: naming a tenant makes it appear on the next read with nothing
 * re-listed, un-naming one makes it stop appearing while its subscriptions stay
 * cached in case it comes back, and a tenant that is both listed and named keeps
 * the real display name the listing gave it.
 *
 * The extras join the **terminal** page, so a reader that stops early sees the
 * same prefix it would have seen anyway. A terminal page is emitted even when
 * `pages` is empty, so named tenants survive a listing that produced nothing.
 */
export async function* withAdditionalTenants(
    pages: AsyncIterable<Page<AzureTenant>>,
    additional: readonly AzureTenant[],
): AsyncIterable<Page<AzureTenant>> {
    const seen = new CaselessSet();
    let emittedTerminalPage = false;

    for await (const page of pages) {
        page.items.forEach(tenant => seen.add(tenant.tenantId));
        if (page.hasMore) {
            yield page;
        } else {
            yield { items: [...page.items, ...additional.filter(tenant => !seen.has(tenant.tenantId))], hasMore: false };
            emittedTerminalPage = true;
        }
    }

    if (!emittedTerminalPage) {
        yield { items: additional.filter(tenant => !seen.has(tenant.tenantId)), hasMore: false };
    }
}
