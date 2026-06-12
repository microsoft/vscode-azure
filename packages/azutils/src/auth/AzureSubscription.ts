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
 */
export interface AzureTenant extends WithRequired<TenantIdDescription, 'tenantId' | 'displayName'> {
    /** The Azure environment (cloud) this tenant belongs to. */
    readonly environment: EnvironmentLike;
    /** The account associated with this tenant. */
    readonly account: AzureAccount;
}

/**
 * Represents an Azure subscription.
 *
 * Unlike the (removed) `@microsoft/vscode-azext-azureauth` model, this type does
 * **not** carry a credential or authentication object. Credentials are produced
 * on demand via the credential-factory DI service (see `ICredentialFactory`).
 *
 * The subscription carries its `tenantId` directly (required); the owning
 * {@linkcode AzureSubscription.tenant tenant} (which also exposes a `tenantId`)
 * is available for the full tenant details.
 */
export interface AzureSubscription extends WithRequired<Subscription, 'subscriptionId' | 'tenantId' | 'displayName'> {
    /** The Azure environment (cloud) to which this subscription belongs. */
    readonly environment: EnvironmentLike;
    /** The tenant to which this subscription belongs. */
    readonly tenant: AzureTenant;
    /** The account associated with this subscription. */
    readonly account: AzureAccount;
}
