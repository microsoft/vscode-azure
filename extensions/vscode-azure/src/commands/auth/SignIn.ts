/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { byAccount, ICredentialFactory, IAzureListingCache, VsCodeExtensionCredential, type AzureListingCache } from '@microsoft/vscode-azure-azutils';
import { CaselessSet, ICodeContext, type QuickPickItemWithData, Roots, showMessage, showSmartQuickPick } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import { GuidPattern } from '../../constants';
import { IAzureViewDataTree } from '../../services';
import { addSignedInTenant } from '../../utils/signedInTenants';
import type { ManagedCommand } from '../ManagedCommand';
import { listFirstPageReachableTenants, type ReachableTenant } from './listReachableAuthNodes';

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
 * added account or tenant appears, and touches the listing cache as little as
 * the change allows: a {@linkcode Roots} re-list for a default sign-in, and for
 * a tenant sign-in either nothing at all (a newly named tenant, which is merged
 * above the cache) or a re-enumeration of just that tenant's subscriptions.
 */
@injectable()
export class SignIn implements ManagedCommand {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IAzureViewDataTree) private readonly tree: IAzureViewDataTree,
        @inject(IAzureListingCache) private readonly listings: AzureListingCache,
        @inject(ICredentialFactory) private readonly credentialFactory: ICredentialFactory,
    ) { }

    /** @inheritdoc */
    public async execute(): Promise<void> {
        const code = this.ctx.code;

        // Detect the current state without prompting: listing accounts goes
        // through `getAccounts`, which never triggers an interactive flow. If
        // listing fails (e.g. a transient error), treat the user as signed out so
        // they can still trigger an interactive sign-in rather than the command
        // failing outright.
        let signedIn: boolean;
        try {
            signedIn = (await this.listings.listAccounts()).length > 0;
        } catch {
            signedIn = false;
        }

        if (!signedIn) {
            // Nobody is signed in yet, so the common case is a plain interactive
            // sign-in to the home tenant.
            if (await this.trySignInToDefault()) {
                // The account set just changed, and the memo says otherwise
                // until it is told to look again.
                await this.refreshAccounts();
                this.tree.invalidate(Roots);
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
        //
        // Tolerate a listing failure: tenant listing can be blocked outright
        // (e.g. conditional access), and the combobox still lets the user type a
        // tenant ID, so a failure is treated as "no suggestions".
        let tenants: ReachableTenant[];
        try {
            tenants = await listFirstPageReachableTenants(this.listings);
        } catch {
            tenants = [];
        }
        const pick = await pickTenantOrEnterId(this.ctx, tenants);
        const session = await this.signInToTenant(pick);

        // A tenant-targeted sign-in can surface an account that was not signed
        // in before, and the accounts memo would otherwise keep saying it was
        // not. Done before anything else so the tree re-list any branch below
        // triggers sees the new account.
        await this.refreshAccounts();

        const accountId = pick.accountId ?? session.account.id;

        // A manually-entered tenant (no account context from the pick) won't show
        // up when listing tenants is blocked (e.g. conditional access), so persist
        // it now that we know which account it resolved to.
        if (!pick.accountId && await addSignedInTenant(code, { accountId, tenantId: pick.tenantId })) {
            // Newly named: nothing cached is untrue, because named tenants are
            // merged above the cache on every read. The tenant appears on the
            // next read with nothing re-listed, and its subscriptions are
            // fetched when something first drills into it. The configuration
            // listener re-renders the tree.
            return;
        }

        // The tenant was already reachable -- picked from the suggestions, or
        // typed but already saved. Its subscriptions are the one thing the
        // sign-in can have changed: it may have authorized subscriptions that
        // were invisible when the tenant was last listed. Nothing else is
        // touched, including every other tenant under the same account.
        this.listings.reenumerateSubscriptions({ accountId, tenantId: pick.tenantId });
        this.tree.invalidate(byAccount(accountId));
    }

    /**
     * Re-list accounts so the memo reflects the sign-in that just happened.
     *
     * Tolerates a listing failure: the sign-in itself succeeded, so failing the
     * command here would be misleading. A failed listing is not retained by the
     * cache, so the tree re-list that follows goes back to Azure and surfaces
     * any lasting problem where the user can see it.
     */
    private async refreshAccounts(): Promise<void> {
        try {
            await this.listings.refreshAccounts();
        } catch {
            // Deliberately ignored; see above.
        }
    }

    /**
     * Attempt an interactive sign-in to the default (home) tenant.
     *
     * Acquires a token via {@linkcode ICredentialFactory} (which owns provider
     * selection and auth logging) rather than calling `getSession` directly, so
     * this stays consistent with the rest of the extension's token acquisition.
     * No scopes are passed: the credential falls back to the environment's
     * default resource-manager scope on its own. `createIfNone: true` is passed
     * explicitly rather than relying on {@linkcode VsCodeExtensionCredential}'s
     * default, so this path keeps prompting for interactive sign-in even if that
     * default ever changes.
     *
     * @returns `true` if a session was established, `false` if sign-in failed or
     * was cancelled (a tenant-targeted sign-in may still be possible).
     */
    private async trySignInToDefault(): Promise<boolean> {
        try {
            const credential = this.credentialFactory({ sessionOptions: { createIfNone: true } });
            return (await credential.getToken([])) !== null;
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
        await showMessage(
            code,
            code.l10n.t('Could not sign in to your default Azure account. Do you want to sign in to a specific tenant by ID instead?'),
            { modal: true, severity: 'warning', stepName: this.constructor.name },
            enterTenantId,
        );
        return true;
    }

    /**
     * Establish a tenant-scoped session for the chosen tenant.
     *
     * Routes through {@linkcode ICredentialFactory} (which owns provider
     * selection, the `VSCODE_TENANT:` scope construction, and auth logging)
     * rather than calling `getSession` directly, so this stays consistent with
     * the rest of the extension's token acquisition. It needs the resolved
     * {@linkcode vscode.AuthenticationSession} (not just a token) to read
     * `account.id`, so it uses the credential's
     * {@linkcode VsCodeExtensionCredential.authenticate authenticate} method
     * instead of `getToken`. The cast is safe because the default factory always
     * produces a {@linkcode VsCodeExtensionCredential}.
     *
     * @returns The established session, whose `account.id` identifies the
     * account the tenant resolved to.
     * @throws If VS Code returns no session. `createIfNone` is set, so the
     * documented outcomes are a session or a thrown cancellation; returning
     * nothing would leave the caller unable to say which account was affected,
     * and treating that as "signed in, account unknown" is what previously drove
     * a full cache discard in response to a sign-in that had not happened.
     */
    private async signInToTenant(pick: TenantPick): Promise<vscode.AuthenticationSession> {
        const credential = this.credentialFactory({
            tenantId: pick.tenantId,
            sessionOptions: {
                createIfNone: true,
                ...(pick.accountId ? { account: { id: pick.accountId, label: '' } } : {}),
            },
        }) as VsCodeExtensionCredential;

        const session = await credential.authenticate();
        if (!session) {
            throw new Error(this.ctx.code.l10n.t('Signing in to tenant {0} returned no session.', pick.tenantId));
        }
        return session;
    }
}

/**
 * The result of {@linkcode pickTenantOrEnterId}: the tenant to sign in to, plus
 * the account it was discovered under when known.
 */
interface TenantPick {
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
 * @internal Exported only for tests.
 */
export async function pickTenantOrEnterId(ctx: ICodeContext, tenants: ReachableTenant[]): Promise<TenantPick> {
    const code = ctx.code;

    const items: QuickPickItemWithData<TenantPick>[] = tenants.map(item => ({
        label: code.l10n.t('{0} ({1})', item.tenant.displayName, item.tenant.tenantId),
        description: code.l10n.t('Account: {0}', item.account.label),
        data: { tenantId: item.tenant.tenantId, accountId: item.account.id },
    }));
    const knownTenantIds = new CaselessSet(tenants.map(item => item.tenant.tenantId));

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
            if (!GuidPattern.test(value) || knownTenantIds.has(value)) {
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
