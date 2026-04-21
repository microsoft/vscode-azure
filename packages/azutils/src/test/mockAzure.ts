/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Environment } from '@azure/ms-rest-azure-env';
import type { AzureAccount, AzureSubscription, AzureTenant } from '@microsoft/vscode-azext-azureauth';
import type { GenericResource } from '../models/GenericResource';
import type { ResourceGroup, VirtualGroup } from '../models/Grouping';
import type { VirtualResource } from '../models/VirtualResource';

const defaultEnvironment = Object.assign(Object.create(Environment.AzureCloud) as Environment, {
    isCustomCloud: false,
});

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
    return {
        tenantId: 'test-tenant',
        displayName: 'Test Tenant',
        account: makeAccount(),
        ...overrides,
    };
}

/**
 * Builds a mock {@linkcode AzureSubscription} with a stub `credential`
 * that returns a fixed token valid for one hour. Default account and
 * environment come from {@linkcode makeAccount} and `Environment.AzureCloud`.
 */
export function makeSubscription(overrides?: Partial<AzureSubscription>): AzureSubscription {
    const account = makeAccount();
    return {
        subscriptionId: 'test-sub',
        tenantId: 'test-tenant',
        name: 'Test Subscription',
        account,
        environment: defaultEnvironment,
        credential: { getToken: () => Promise.resolve({ token: 'mock-token', expiresOnTimestamp: Date.now() + 3600000 }) },
        isCustomCloud: false,
        authentication: { getSession: () => Promise.resolve(undefined) },
        ...overrides,
    } as AzureSubscription;
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
