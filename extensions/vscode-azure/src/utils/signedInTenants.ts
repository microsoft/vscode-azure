/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IVsCode } from '@microsoft/vscode-azure-utils';
import { ConfigurationSection, GuidPattern, SignedInTenantsConfigurationKey } from '../constants';

/**
 * A tenant the user signed in to by manually entering its id, recorded so the
 * resources tree can reach it even when listing tenants is blocked (e.g.
 * conditional access).
 *
 * The owning account is referenced by {@linkcode SignedInTenant.accountId}
 * (the VS Code authentication account id, kept verbatim so it can be passed
 * straight to `getSession`). The {@linkcode SignedInTenant.tenantId} is stored
 * lowercased to match the casing the data provider uses for listed tenants.
 */
export interface SignedInTenant {
    readonly accountId: string;
    readonly tenantId: string;
}

/** Narrows an arbitrary configuration value to a {@linkcode SignedInTenant}. */
function isSignedInTenant(value: unknown): value is SignedInTenant {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const entry = value as Partial<SignedInTenant>;
    return typeof entry.accountId === 'string' && entry.accountId.length > 0
        && typeof entry.tenantId === 'string' && GuidPattern.test(entry.tenantId);
}

/**
 * Read the manually-entered tenants persisted in
 * {@linkcode SignedInTenantsConfigurationKey}.
 *
 * The setting is user-editable, so malformed entries are tolerated: anything
 * that isn't a well-formed {@linkcode SignedInTenant} (a non-empty account id
 * and a canonical tenant GUID) is dropped rather than throwing.
 */
export function readSignedInTenants(code: IVsCode): SignedInTenant[] {
    const config = code.workspace.getConfiguration(ConfigurationSection);
    const raw = config.get<unknown>(SignedInTenantsConfigurationKey, []);
    return Array.isArray(raw) ? raw.filter(isSignedInTenant) : [];
}

/**
 * Persist a manually-entered tenant, additively and idempotently: an entry
 * already present (same account id and case-insensitive tenant id) is left
 * untouched, so repeated sign-ins don't accumulate duplicates.
 *
 * The tenant id is stored lowercased to match the data provider's casing.
 *
 * @returns `true` if a new entry was written to configuration, or `false` if
 * the tenant was already saved (no change, so no configuration-change event
 * fires -- callers that rely on the configuration listener to refresh should
 * handle this case themselves).
 */
export async function addSignedInTenant(code: IVsCode, entry: SignedInTenant): Promise<boolean> {
    const tenantId = entry.tenantId.toLowerCase();
    const accountId = entry.accountId.toLowerCase();
    const existing = readSignedInTenants(code);
    // Compare account ids case-insensitively (matching the `byAccount` selector):
    // VS Code's auth account id is an opaque provider string with no documented
    // case-stability guarantee, and this setting is user-editable, so a casing
    // difference must not defeat dedupe. The verbatim casing is still persisted
    // below so it can be passed straight to `getSession`.
    if (existing.some(e => e.accountId.toLowerCase() === accountId && e.tenantId.toLowerCase() === tenantId)) {
        return false;
    }

    const next: SignedInTenant[] = [...existing, { accountId: entry.accountId, tenantId }];
    const config = code.workspace.getConfiguration(ConfigurationSection);
    await config.update(SignedInTenantsConfigurationKey, next, code.ConfigurationTarget.Global);
    return true;
}
