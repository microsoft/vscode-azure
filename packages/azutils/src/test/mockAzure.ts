/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Environment } from '@azure/ms-rest-azure-env';
import type { AzureAccount, AzureSubscription, AzureTenant } from '@microsoft/vscode-azext-azureauth';
import type { GenericResource } from '../models/GenericResource';
import type { ResourceGroup } from '../models/Grouping';

const defaultEnvironment = Object.assign(Object.create(Environment.AzureCloud) as Environment, {
    isCustomCloud: false,
});

export function makeAccount(overrides?: Partial<AzureAccount>): AzureAccount {
    return {
        id: 'test-account',
        label: 'Test Account',
        environment: defaultEnvironment,
        ...overrides,
    } as AzureAccount;
}

export function makeTenant(overrides?: Partial<AzureTenant>): AzureTenant {
    return {
        tenantId: 'test-tenant',
        displayName: 'Test Tenant',
        account: makeAccount(),
        ...overrides,
    } as AzureTenant;
}

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
    } as ResourceGroup;
}

export function makeGenericResource(overrides?: Partial<GenericResource>): GenericResource {
    return {
        id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Web/sites/site1',
        name: 'site1',
        type: 'Microsoft.Web/sites',
        location: 'eastus',
        logicalType: 'Microsoft.Web/sites',
        subscription: makeSubscription(),
        ...overrides,
    } as GenericResource;
}
