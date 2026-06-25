/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { byAccount, getAuthProviderId, getConfiguredAzureEnv, isAccount } from '@microsoft/vscode-azure-azutils';
import { Everything, ICodeContext, Roots } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureViewDataTree } from '../services';
import { listFirstPageReachableTenants, type ReachableTenant } from './listReachableAuthNodes';
import type { ManagedCommand } from './ManagedCommand';
import { pickTenantOrEnterId, type TenantPick } from './pickTenant';

/**
 * Signs the user in to Azure, adapting to what they actually need.
 *
 * Listing accounts is non-interactive (the resources tree uses `getAccounts`,
 * which never prompts), so when the user is signed out of every account nothing
 * triggers VS Code's sign-in flow. This command branches based on the current
 * state so a single entry point covers the common cases:
 *
 * - **Signed out:** performs a plain interactive sign-in to the home tenant
 *   (`getSession({ createIfNone: true })`). If that fails or is declined (e.g.
 *   conditional access blocks the home tenant), it offers to sign in to a
 *   specific tenant by ID instead.
 * - **Already signed in:** the user is signing in again to reach a tenant they
 *   can't yet see (for example one behind stricter MFA), so it shows a combobox
 *   of the first page of reachable tenants and also lets them type any tenant ID
 *   directly (see {@linkcode pickTenantOrEnterId}).
 *
 * After a successful sign-in it invalidates the resources tree so the freshly
 * added account/tenant appears: a {@linkcode Roots} re-list for a default
 * sign-in, or the affected account's subtree ({@linkcode byAccount}) / the whole
 * tree ({@linkcode Everything}) for a tenant sign-in, since a reconciling
 * {@linkcode Roots} re-list would otherwise preserve the previously-empty
 * subscription list of a newly authorized tenant.
 */
@injectable()
export class SignIn implements ManagedCommand {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IAzureViewDataTree) private readonly cache: IAzureViewDataTree,
    ) { }

    /** @inheritdoc */
    public async execute(): Promise<void> {
        const code = this.ctx.code;
        const environment = getConfiguredAzureEnv(code);
        const providerId = getAuthProviderId(environment);
        const defaultScopes = [environment.resourceManagerDefaultScope];

        // Detect the current state without prompting: the resources tree lists
        // already-signed-in accounts via `getAccounts`, which never triggers an
        // interactive flow.
        const signedIn = (await this.cache.getChildren()).some(isAccount);

        if (!signedIn) {
            // Nobody is signed in yet, so the common case is a plain interactive
            // sign-in to the home tenant.
            if (await this.trySignInToDefault(providerId, defaultScopes)) {
                this.cache.invalidate(Roots);
                return;
            }

            // Default sign-in failed or was declined. Only continue to a
            // tenant-targeted sign-in (e.g. conditional access blocks the home
            // tenant) if the user opts in.
            if (!await this.confirmTenantSignIn()) {
                return;
            }
        }

        // Either the user is already signed in (signing in again to reach a
        // tenant they can't yet see) or default sign-in is not possible. Offer a
        // single combobox: pick a reachable tenant or type a tenant ID.
        const tenants = await this.tryListTenants();
        const pick = await pickTenantOrEnterId(this.ctx, tenants);
        await this.signInToTenant(providerId, defaultScopes, pick);
        this.cache.invalidate(pick.accountId ? byAccount(pick.accountId) : Everything);
    }

    /**
     * Attempt an interactive sign-in to the default (home) tenant.
     *
     * @returns `true` if a session was established, `false` if sign-in failed or
     * was cancelled (a tenant-targeted sign-in may still be possible).
     */
    private async trySignInToDefault(providerId: string, defaultScopes: string[]): Promise<boolean> {
        try {
            await this.ctx.code.authentication.getSession(providerId, defaultScopes, { createIfNone: true });
            return true;
        } catch {
            // Swallow: the caller decides whether to offer a tenant-targeted
            // sign-in. Both an outright failure (conditional access) and a user
            // cancellation land here, and in either case we should not surface an
            // error -- we just stop or offer the tenant path.
            return false;
        }
    }

    /**
     * Ask the user whether to fall back to signing in to a specific tenant by ID
     * after a failed/declined default sign-in.
     */
    private async confirmTenantSignIn(): Promise<boolean> {
        const code = this.ctx.code;
        const enterTenantId = code.l10n.t('Enter Tenant ID');
        const choice = await code.window.showWarningMessage(
            code.l10n.t('Could not sign in to your default Azure account. Do you want to sign in to a specific tenant by ID instead?'),
            { modal: true },
            enterTenantId,
        );
        return choice === enterTenantId;
    }

    /**
     * List the first page of reachable tenants to suggest, tolerating failure:
     * tenant listing can be blocked outright (e.g. conditional access), and the
     * combobox still lets the user type a tenant ID, so a listing failure is
     * treated as "no suggestions".
     */
    private async tryListTenants(): Promise<ReachableTenant[]> {
        try {
            return await listFirstPageReachableTenants(this.cache);
        } catch {
            return [];
        }
    }

    /** Establish a tenant-scoped session for the chosen tenant. */
    private async signInToTenant(providerId: string, defaultScopes: string[], pick: TenantPick): Promise<void> {
        const scopes = [...defaultScopes, `VSCODE_TENANT:${pick.tenantId}`];
        const options = pick.accountId
            ? { createIfNone: true, account: { id: pick.accountId, label: '' } }
            : { createIfNone: true };

        await this.ctx.code.authentication.getSession(providerId, scopes, options);
    }
}
