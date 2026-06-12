/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TokenCredential } from '@azure/core-auth';
import type { IOutputChannel, IVsCode, SyncFactory } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';
import { VsCodeExtensionCredential } from './VsCodeExtensionCredential';

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
 * Factory that produces a {@linkcode TokenCredential} for Azure requests. The
 * default implementation creates a {@linkcode VsCodeExtensionCredential}, which
 * determines the cloud / auth provider itself.
 */
export type ICredentialFactory = SyncFactory<TokenCredential, [options?: CredentialFactoryOptions]>;

/** DI identifier for the {@linkcode ICredentialFactory}. */
export const ICredentialFactory: ServiceIdentifier<ICredentialFactory> = Symbol.for('ICredentialFactory');

/**
 * Build the default {@linkcode ICredentialFactory}, which creates a
 * {@linkcode VsCodeExtensionCredential} for each request.
 *
 * @param code - The VS Code namespace, forwarded to each credential.
 * @param output - (Optional) Output channel for auth lifecycle logging.
 */
export function createDefaultCredentialFactory(code: IVsCode, output?: IOutputChannel): ICredentialFactory {
    return (options) => new VsCodeExtensionCredential({
        code,
        output,
        tenantId: options?.tenantId,
        sessionOptions: options?.sessionOptions,
    });
}
