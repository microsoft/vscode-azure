/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { WithRequired } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';
import type { Subscription, TenantIdDescription } from '../rest/clients/SubscriptionClient';
import type { EnvironmentLike } from './Environment';

/**
 * An Azure account the user is signed in to.
 *
 * A thin wrapper over {@linkcode vscode.AuthenticationSessionAccountInformation}
 * that also carries the {@linkcode EnvironmentLike} the account belongs to.
 */
export type AzureAccount = vscode.AuthenticationSessionAccountInformation & {
    /** The Azure environment (cloud) this account belongs to. */
    readonly environment: EnvironmentLike;
};

/**
 * An Azure tenant associated with a specific {@linkcode AzureAccount}.
 *
 * The owning account is referenced by id rather than by object embed so
 * that tenants remain plain, immutable value objects: callers must not rely on
 * reference equality against a shared {@linkcode AzureAccount} instance.
 */
export interface AzureTenant extends WithRequired<TenantIdDescription, 'tenantId' | 'displayName'> {
    /** The Azure environment (cloud) this tenant belongs to. */
    readonly environment: EnvironmentLike;
    /**
     * The id of the {@linkcode AzureAccount} this tenant belongs to.
     *
     * This is the VS Code authentication account id (used verbatim for
     * `getSession`), so it is kept exactly as issued and is **not**
     * case-normalized on the object.
     */
    readonly accountId: string;
}

/**
 * Represents an Azure subscription.
 *
 * Unlike the (removed) `@microsoft/vscode-azext-azureauth` model, this type does
 * **not** carry a credential or authentication object. Credentials are produced
 * on demand via the credential-factory DI service (see `ICredentialFactory`).
 *
 * The subscription carries its `tenantId` directly (required) and references its
 * owning account by id rather than by object embed, so callers must not
 * rely on reference equality against a shared {@linkcode AzureAccount} or
 * {@linkcode AzureTenant} instance.
 *
 * `tenantId` is the tenant the subscription was **listed through**, which is the
 * tenant a credential for it must be scoped to. That is not always the tenant
 * that owns the subscription, so the same subscription reached through two
 * tenants is two distinct nodes.
 */
export interface AzureSubscription extends WithRequired<Subscription, 'subscriptionId' | 'tenantId' | 'displayName'> {
    /** The Azure environment (cloud) to which this subscription belongs. */
    readonly environment: EnvironmentLike;
    /**
     * The id of the {@linkcode AzureAccount} this subscription belongs to.
     *
     * This is the VS Code authentication account id (used verbatim for
     * `getSession`), so it is kept exactly as issued and is **not**
     * case-normalized on the object.
     */
    readonly accountId: string;
}

/**
 * Defensive type guard that narrows an arbitrary value to an
 * {@linkcode AzureSubscription}.
 *
 * Checks that the value is a non-null object carrying the subscription's
 * defining fields (`subscriptionId`, `tenantId`, and the owning `accountId`).
 * This distinguishes a subscription from related shapes such as an
 * {@linkcode AzureAccount}, {@linkcode AzureTenant}, or a plain options object.
 */
export function isAzureSubscription(value: unknown): value is AzureSubscription {
    return (
        typeof value === 'object' &&
        value !== null &&
        'subscriptionId' in value &&
        'tenantId' in value &&
        'accountId' in value
    );
}
