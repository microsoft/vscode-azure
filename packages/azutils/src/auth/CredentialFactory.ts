/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TokenCredential } from '@azure/core-auth';
import type { IOutputChannel, IVsCode, SyncFactory } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';
import { isAzureSubscriptionTarget, type AzureSubscriptionTarget } from './AzureSubscription';
import { VsCodeExtensionCredential, type TenantDiscovery } from './VsCodeExtensionCredential';

export type { TokenCredential };

/**
 * Options passed to an {@linkcode ICredentialFactory} to scope the produced
 * credential to a particular tenant / account.
 */
export interface CredentialFactoryOptions {
    /** (Optional) The tenant ID the credential should authenticate to. */
    readonly tenantId?: string;

    /**
     * (Optional) Options forwarded to {@linkcode vscode.authentication.getSession getSession},
     * e.g. the `account` to scope to, or `silent` / `createIfNone` behavior.
     */
    readonly sessionOptions?: vscode.AuthenticationGetSessionOptions;
}

/**
 * Input accepted by an {@linkcode ICredentialFactory}: either explicit
 * {@linkcode CredentialFactoryOptions}, or an {@linkcode AzureSubscriptionTarget}
 * (whose `tenantId` and `accountId` are used to scope the credential).
 */
export type CredentialFactoryInput = CredentialFactoryOptions | AzureSubscriptionTarget;

/**
 * Factory that produces a {@linkcode TokenCredential} for Azure requests. The
 * default implementation creates a {@linkcode VsCodeExtensionCredential}, which
 * determines the cloud / auth provider itself.
 *
 * Accepts either {@linkcode CredentialFactoryOptions} or an
 * {@linkcode AzureSubscriptionTarget}; passing a target is shorthand for
 * `{ tenantId: target.tenantId, sessionOptions: { account: { id: target.accountId, label: '' } } }`.
 *
 * The account `label` is intentionally empty: {@linkcode vscode.authentication.getSession getSession}
 * resolves the account by `id`, and `label` is a required-but-display-only field.
 */
export type ICredentialFactory = SyncFactory<TokenCredential, [input?: CredentialFactoryInput]>;

/** DI identifier for the {@linkcode ICredentialFactory}. */
export const ICredentialFactory: ServiceIdentifier<ICredentialFactory> = Symbol.for('ICredentialFactory');

/**
 * Normalizes a {@linkcode CredentialFactoryInput} to {@linkcode CredentialFactoryOptions}.
 *
 * A target with no `accountId` yields no `account` at all rather than an empty
 * one, so `getSession` is free to answer with whichever signed-in account can
 * reach the tenant. That is the right answer for a caller that knows the
 * subscription and tenant but never enumerated accounts: the tenant already
 * pins the authority, and the account only breaks a tie between two accounts
 * that both reach it.
 */
function toCredentialFactoryOptions(input?: CredentialFactoryInput): CredentialFactoryOptions | undefined {
    if (isAzureSubscriptionTarget(input)) {
        return {
            tenantId: input.tenantId,
            sessionOptions: input.accountId ? { account: { id: input.accountId, label: '' } } : undefined,
        };
    }
    return input;
}

/**
 * Merge caller-supplied session options over ambient `defaults`. The caller's
 * per-request scoping (e.g. `account`) wins on a per-key basis, while
 * `defaults` (e.g. `silent: true`) fill in any keys the caller did not set.
 *
 * Returns `undefined` when neither side supplies options, preserving the exact
 * shape a credential sees when no ambient defaults are configured (so the
 * common interactive path is byte-identical to having no defaults at all).
 */
function mergeSessionOptions(
    defaults: vscode.AuthenticationGetSessionOptions | undefined,
    caller: vscode.AuthenticationGetSessionOptions | undefined,
): vscode.AuthenticationGetSessionOptions | undefined {
    if (!defaults) {
        return caller;
    }
    if (!caller) {
        return defaults;
    }
    return { ...defaults, ...caller };
}

/**
 * Build the default {@linkcode ICredentialFactory}, which creates a
 * {@linkcode VsCodeExtensionCredential} for each request.
 *
 * When `getDefaults` is supplied, it is consulted at *call* time (each time the
 * factory produces a credential) for ambient {@linkcode CredentialFactoryOptions}
 * to merge *beneath* the caller's per-request input. This lets an ambient scope
 * (e.g. a discovery walk that wants `silent: true`) influence a credential built
 * by a long-lived singleton without threading options through every call site.
 * The caller's input always wins on a per-key basis; when `getDefaults` returns
 * `undefined` the merge is a no-op.
 *
 * @param code - The VS Code namespace, forwarded to each credential.
 * @param output - (Optional) Output channel for auth lifecycle logging.
 * @param getDefaults - (Optional) Callback returning ambient options to merge
 * beneath each request's input, evaluated per credential.
 * @param onTenantDiscovered - (Optional) Called when a request rejected as
 * wrong-tenant succeeded against the tenant the service named.
 */
export function createDefaultCredentialFactory(
    code: IVsCode,
    output?: IOutputChannel,
    getDefaults?: () => CredentialFactoryOptions | undefined,
    onTenantDiscovered?: (discovery: TenantDiscovery) => void,
): ICredentialFactory {
    return (input) => {
        const options = toCredentialFactoryOptions(input);
        const defaults = getDefaults?.();
        return new VsCodeExtensionCredential({
            code,
            output,
            tenantId: options?.tenantId ?? defaults?.tenantId,
            sessionOptions: mergeSessionOptions(defaults?.sessionOptions, options?.sessionOptions),
            onTenantDiscovered,
        });
    };
}
