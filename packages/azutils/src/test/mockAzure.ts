/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AccessToken, TokenCredential } from '@azure/core-auth';
import type { ChildResult, DataProvider } from '@microsoft/vscode-azure-utils';
import { mock } from 'node:test';
import type { AzureAccount, AzureSubscription, AzureTenant } from '../auth/AzureSubscription';
import { AzurePublicCloud, type EnvironmentLike } from '../auth/Environment';
import { isAccount, isTenant, type ConcreteAzureNode } from '../models/AzureNode';
import type { GenericResource } from '../models/GenericResource';
import type { ResourceGroup, VirtualGroup } from '../models/Grouping';
import type { VirtualResource } from '../models/VirtualResource';

const defaultEnvironment: EnvironmentLike = AzurePublicCloud;

/**
 * Builds a mock {@linkcode AzureAccount} with sensible defaults.
 * Pass `overrides` to customise individual fields.
 */
export function makeAccount(overrides?: Partial<AzureAccount>): AzureAccount {
    return {
        id: 'test-account',
        label: 'Test Account',
        environment: defaultEnvironment,
        ...overrides,
    };
}

/**
 * Builds a mock {@linkcode AzureTenant} whose default `account` is a fresh
 * {@linkcode makeAccount} instance.
 */
export function makeTenant(overrides?: Partial<AzureTenant>): AzureTenant {
    const account = makeAccount(overrides?.account);
    return {
        tenantId: 'test-tenant',
        displayName: 'Test Tenant',
        ...overrides,
        environment: account.environment,
        account,
    };
}

/**
 * Builds a mock {@linkcode AzureSubscription}. Default account and environment
 * come from {@linkcode makeAccount} and {@linkcode AzurePublicCloud}, and the
 * default tenant from {@linkcode makeTenant}.
 */
export function makeSubscription(overrides?: Partial<AzureSubscription>): AzureSubscription {
    const account = makeAccount(overrides?.account);
    const tenant = makeTenant({ account, ...overrides?.tenant });
    return {
        subscriptionId: 'test-sub',
        displayName: 'Test Subscription',
        ...overrides,
        tenant,
        account,
        tenantId: tenant.tenantId,
        environment: tenant.environment,
    };
}

/**
 * Builds a mock {@linkcode TokenCredential} whose `getToken` returns a fixed
 * token valid for one hour. The method is wrapped with `mock.fn()` from
 * `node:test` so callers can assert call counts and inspect `GetTokenOptions`
 * (e.g. `claims` for CAE/MFA challenge handling).
 */
export function makeCredential(token = 'mock-token'): TokenCredential {
    return {
        getToken: mock.fn((): Promise<AccessToken> => Promise.resolve({ token, expiresOnTimestamp: Date.now() + 3600000 })),
    };
}

/**
 * Builds a mock {@linkcode ResourceGroup} rooted in the default
 * {@linkcode makeSubscription}.
 */
export function makeResourceGroup(overrides?: Partial<ResourceGroup>): ResourceGroup {
    return {
        id: '/subscriptions/test-sub/resourceGroups/rg1',
        name: 'rg1',
        type: 'Microsoft.Resources/resourceGroups',
        location: 'eastus',
        logicalType: 'Microsoft.Resources/resourceGroups',
        subscription: makeSubscription(),
        groupingStrategy: 'resourceGroup',
        groupingValue: 'rg1',
        ...overrides,
    };
}

/**
 * Builds a mock {@linkcode GenericResource} representing a web site in
 * the default resource group.
 */
export function makeGenericResource(overrides?: Partial<GenericResource>): GenericResource {
    return {
        id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Web/sites/site1',
        name: 'site1',
        type: 'Microsoft.Web/sites',
        location: 'eastus',
        logicalType: 'Microsoft.Web/sites',
        subscription: makeSubscription(),
        ...overrides,
    };
}

/**
 * Builds a mock {@linkcode VirtualGroup} (a non-Azure grouping node in
 * the tree) for the default subscription.
 */
export function makeVirtualGroup(overrides?: Partial<VirtualGroup>): VirtualGroup {
    return {
        groupingStrategy: 'resourceType',
        groupingValue: 'Microsoft.Web/sites',
        subscription: makeSubscription(),
        ...overrides,
    };
}

/**
 * Builds a mock {@linkcode VirtualResource} (a synthetic child resource
 * such as a container-registry repository) hanging off the default
 * {@linkcode makeGenericResource}.
 */
export function makeVirtualResource(overrides?: Partial<VirtualResource>): VirtualResource {
    return {
        virtualType: 'repository',
        virtualPath: 'myrepo',
        azureResource: makeGenericResource(),
        ...overrides,
    };
}

/** Options for overriding mock account/tenant/subscription data defaults. */
export interface MockSubscriptionProviderOptions {
    readonly accounts?: AzureAccount[];
    readonly tenants?: AzureTenant[];
    readonly subscriptions?: AzureSubscription[];
}

/**
 * Creates a mock subscription provider exposing `getAvailableSubscriptions`,
 * matching the extension's command-consumer service shape. The method is wrapped
 * with `mock.fn()` from `node:test` so callers can assert call counts.
 */
export function createMockSubscriptionProvider(options?: MockSubscriptionProviderOptions): { getAvailableSubscriptions: () => Promise<AzureSubscription[]> } {
    const subscriptions = options?.subscriptions ?? [makeSubscription()];
    return {
        getAvailableSubscriptions: mock.fn(() => Promise.resolve(subscriptions)),
    };
}

/**
 * Creates a mock root {@linkcode DataProvider} that yields canned accounts,
 * tenants, and subscriptions -- a stand-in for the real
 * `AzureAccountDataProvider` in tree tests and mock-data mode.
 *
 * {@linkcode DataProvider.getChildren getChildren} is wrapped with `mock.fn()`
 * so callers can assert call counts and arguments.
 */
export function createMockAccountDataProvider(options?: MockSubscriptionProviderOptions): DataProvider<ConcreteAzureNode> {
    const accounts = options?.accounts ?? [makeAccount()];
    const tenants = options?.tenants ?? [makeTenant()];
    const subscriptions = options?.subscriptions ?? [makeSubscription()];

    return {
        isRoot: true,
        getTtl: () => Infinity,
        canHandle: (resource: unknown): resource is ConcreteAzureNode => {
            if (!resource || typeof resource !== 'object') {
                return false;
            }
            const node = resource as ConcreteAzureNode;
            return isAccount(node) || isTenant(node);
        },
        getChildren: mock.fn((resource?: ConcreteAzureNode): Promise<ChildResult<ConcreteAzureNode>> => {
            if (!resource) {
                return Promise.resolve(accounts as ConcreteAzureNode[]);
            } else if (isAccount(resource)) {
                return Promise.resolve(tenants as ConcreteAzureNode[]);
            } else if (isTenant(resource)) {
                return Promise.resolve(subscriptions as ConcreteAzureNode[]);
            } else {
                throw new Error(`Unsupported resource type: ${JSON.stringify(resource)}`);
            }
        }),
    };
}
