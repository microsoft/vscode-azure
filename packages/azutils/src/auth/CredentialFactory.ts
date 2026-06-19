/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TokenCredential } from '@azure/core-auth';
import type { IOutputChannel, IVsCode, SyncFactory } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';
import { isAzureSubscription, type AzureSubscription } from './AzureSubscription';
import { VsCodeExtensionCredential } from './VsCodeExtensionCredential';

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
 * {@linkcode CredentialFactoryOptions}, or an {@linkcode AzureSubscription}
 * (whose `tenantId` and `accountId` are used to scope the credential).
 */
export type CredentialFactoryInput = CredentialFactoryOptions | AzureSubscription;

/**
 * Factory that produces a {@linkcode TokenCredential} for Azure requests. The
 * default implementation creates a {@linkcode VsCodeExtensionCredential}, which
 * determines the cloud / auth provider itself.
 *
 * Accepts either {@linkcode CredentialFactoryOptions} or an
 * {@linkcode AzureSubscription}; passing a subscription is shorthand for
 * `{ tenantId: subscription.tenantId, sessionOptions: { account: { id: subscription.accountId, label: '' } } }`.
 *
 * The account `label` is intentionally empty: {@linkcode vscode.authentication.getSession getSession}
 * resolves the account by `id`, and `label` is a required-but-display-only field.
 */
export type ICredentialFactory = SyncFactory<TokenCredential, [input?: CredentialFactoryInput]>;

/** DI identifier for the {@linkcode ICredentialFactory}. */
export const ICredentialFactory: ServiceIdentifier<ICredentialFactory> = Symbol.for('ICredentialFactory');

/** Normalizes a {@linkcode CredentialFactoryInput} to {@linkcode CredentialFactoryOptions}. */
function toCredentialFactoryOptions(input?: CredentialFactoryInput): CredentialFactoryOptions | undefined {
    if (isAzureSubscription(input)) {
        return { tenantId: input.tenantId, sessionOptions: { account: { id: input.accountId, label: '' } } };
    }
    return input;
}

/**
 * Build the default {@linkcode ICredentialFactory}, which creates a
 * {@linkcode VsCodeExtensionCredential} for each request.
 *
 * @param code - The VS Code namespace, forwarded to each credential.
 * @param output - (Optional) Output channel for auth lifecycle logging.
 */
export function createDefaultCredentialFactory(code: IVsCode, output?: IOutputChannel): ICredentialFactory {
    return (input) => {
        const options = toCredentialFactoryOptions(input);
        return new VsCodeExtensionCredential({
            code,
            output,
            tenantId: options?.tenantId,
            sessionOptions: options?.sessionOptions,
        });
    };
}
