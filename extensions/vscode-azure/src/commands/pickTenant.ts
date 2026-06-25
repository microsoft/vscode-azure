/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ICodeContext, type QuickPickItemWithData, showSmartQuickPick } from '@microsoft/vscode-azure-utils';
import type { ReachableTenant } from './listReachableAuthNodes';

/**
 * Matches a canonical tenant GUID (e.g. `aaaabbbb-cccc-dddd-eeee-ffff00001111`).
 *
 * Used to gate the synthetic "sign in to tenant `<id>`" item: a tenant ID is
 * always a GUID, and users paste (rather than type) one, so any non-GUID value
 * is treated as a filter over the suggestions instead of a sign-in target.
 */
const tenantIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The result of {@linkcode pickTenantOrEnterId}: the tenant to sign in to, plus
 * the account it was discovered under when known.
 */
export interface TenantPick {
    /** The tenant id to sign in to (lowercased when it came from a suggestion). */
    readonly tenantId: string;

    /**
     * The id of the account the tenant was discovered under, when the user
     * picked a suggested tenant. `undefined` when the user typed a tenant ID
     * that was not in the suggestion list (so no account context is known).
     */
    readonly accountId?: string;
}

/**
 * Show a combobox-style quick pick for choosing a tenant to sign in to.
 *
 * Behaves like a combo box: the {@linkcode tenants} are shown as suggestions
 * (typically only the first page, to avoid enumerating accounts with hundreds of
 * tenants), but the user can also type any tenant ID directly. When the typed
 * value does not match a suggested tenant, a synthetic "sign in to tenant `<id>`"
 * item is offered, so the control works even when tenants cannot be listed at all
 * (e.g. conditional-access restrictions).
 *
 * @param ctx - VS Code dependencies.
 * @param tenants - Suggested tenants to list (may be empty).
 * @returns The chosen {@linkcode TenantPick}.
 * @throws {@linkcode CancellationError} if the user dismisses the quick pick.
 */
export async function pickTenantOrEnterId(ctx: ICodeContext, tenants: ReachableTenant[]): Promise<TenantPick> {
    const code = ctx.code;

    const items: QuickPickItemWithData<TenantPick>[] = tenants.map(item => ({
        label: code.l10n.t('{0} ({1})', item.tenant.displayName, item.tenant.tenantId),
        description: code.l10n.t('Account: {0}', item.account.label),
        data: { tenantId: item.tenant.tenantId, accountId: item.account.id },
    }));
    const knownTenantIds = new Set(tenants.map(item => item.tenant.tenantId.toLowerCase()));

    const picked = await showSmartQuickPick(ctx, items, {
        title: code.l10n.t('Sign in to a Tenant'),
        placeHolder: tenants.length > 0
            ? code.l10n.t('Select a tenant, or type a tenant ID to sign in to')
            : code.l10n.t('Type the ID of the tenant to sign in to'),
        matchOnDescription: true,
        // Combo box: offer a "sign in to <typed id>" item only when the value
        // is a tenant GUID that isn't already one of the suggestions. Users
        // paste tenant IDs rather than typing them, so any non-GUID value is a
        // filter over the suggestions, not a sign-in target.
        createItemFromValue: (value) => {
            if (!tenantIdPattern.test(value) || knownTenantIds.has(value.toLowerCase())) {
                return undefined;
            }
            return {
                label: code.l10n.t('Sign in to tenant: {0}', value),
                data: { tenantId: value },
            };
        },
    });

    return picked.data;
}
