/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IVsCode } from '@microsoft/vscode-azure-utils';
import { ConfigurationSection, SignedInTenantsConfigurationKey } from './constants';

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
        && typeof entry.tenantId === 'string' && entry.tenantId.length > 0;
}

/**
 * Read the manually-entered tenants persisted in
 * {@linkcode SignedInTenantsConfigurationKey}.
 *
 * The setting is user-editable, so malformed entries are tolerated: anything
 * that isn't a well-formed {@linkcode SignedInTenant} is dropped rather than
 * throwing.
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
 */
export async function addSignedInTenant(code: IVsCode, entry: SignedInTenant): Promise<void> {
    const tenantId = entry.tenantId.toLowerCase();
    const existing = readSignedInTenants(code);
    if (existing.some(e => e.accountId === entry.accountId && e.tenantId.toLowerCase() === tenantId)) {
        return;
    }

    const next: SignedInTenant[] = [...existing, { accountId: entry.accountId, tenantId }];
    const config = code.workspace.getConfiguration(ConfigurationSection);
    await config.update(SignedInTenantsConfigurationKey, next, code.ConfigurationTarget.Global);
}
