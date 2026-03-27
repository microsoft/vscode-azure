/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Environment } from '@azure/ms-rest-azure-env';
import type { AzureAccount, AzureSubscription, AzureSubscriptionProvider, AzureTenant } from '@microsoft/vscode-azext-azureauth';
import type { IAcrClient, IResourceClient } from '@microsoft/vscode-azure-azutils';
import type { IVsCode } from '@microsoft/vscode-azure-utils';
import type { IAcrClientProvider, IResourceClientProvider } from '../services';

// -- Fake Azure environment -----------------------------------------------

const mockEnvironment = Object.assign(Object.create(Environment.AzureCloud) as Environment, {
    isCustomCloud: false,
});

const mockAccount: AzureAccount = {
    id: 'mock-account',
    label: 'Mock Account',
    environment: mockEnvironment,
} as AzureAccount;

const mockTenant: AzureTenant = {
    tenantId: 'mock-tenant',
    displayName: 'Mock Tenant',
    account: mockAccount,
} as AzureTenant;

const mockSubscription = {
    subscriptionId: 'mock-sub-1',
    tenantId: 'mock-tenant',
    name: 'Mock Subscription',
    account: mockAccount,
    environment: mockEnvironment,
    credential: { getToken: () => Promise.resolve({ token: 'mock-token', expiresOnTimestamp: Date.now() + 3600000 }) },
    isCustomCloud: false,
    authentication: { getSession: () => Promise.resolve(undefined) },
} as unknown as AzureSubscription;

// -- Fake ARM data --------------------------------------------------------

const resourceGroups = [
    { id: '/subscriptions/mock-sub-1/resourceGroups/demo-rg', name: 'demo-rg', type: 'Microsoft.Resources/resourceGroups', location: 'eastus', logicalType: 'Microsoft.Resources/resourceGroups', subscription: mockSubscription, groupingStrategy: 'resourceGroup' as const, groupingValue: 'demo-rg' },
    { id: '/subscriptions/mock-sub-1/resourceGroups/staging-rg', name: 'staging-rg', type: 'Microsoft.Resources/resourceGroups', location: 'westus2', logicalType: 'Microsoft.Resources/resourceGroups', subscription: mockSubscription, groupingStrategy: 'resourceGroup' as const, groupingValue: 'staging-rg' },
];

const resourcesByGroup: Record<string, object[]> = {
    'demo-rg': [
        { id: '/subscriptions/mock-sub-1/resourceGroups/demo-rg/providers/Microsoft.ContainerRegistry/registries/myDemoRegistry', name: 'myDemoRegistry', type: 'Microsoft.ContainerRegistry/registries', logicalType: 'Microsoft.ContainerRegistry/registries', location: 'eastus', subscription: mockSubscription },
        { id: '/subscriptions/mock-sub-1/resourceGroups/demo-rg/providers/Microsoft.Web/sites/demo-webapp', name: 'demo-webapp', type: 'Microsoft.Web/sites', logicalType: 'Microsoft.Web/sites', location: 'eastus', subscription: mockSubscription },
        { id: '/subscriptions/mock-sub-1/resourceGroups/demo-rg/providers/Microsoft.Storage/storageAccounts/demostorage', name: 'demostorage', type: 'Microsoft.Storage/storageAccounts', logicalType: 'Microsoft.Storage/storageAccounts', location: 'eastus', subscription: mockSubscription },
    ],
    'staging-rg': [
        { id: '/subscriptions/mock-sub-1/resourceGroups/staging-rg/providers/Microsoft.ContainerRegistry/registries/stagingReg', name: 'stagingReg', type: 'Microsoft.ContainerRegistry/registries', logicalType: 'Microsoft.ContainerRegistry/registries', location: 'westus2', subscription: mockSubscription },
        { id: '/subscriptions/mock-sub-1/resourceGroups/staging-rg/providers/Microsoft.Sql/servers/staging-sql', name: 'staging-sql', type: 'Microsoft.Sql/servers', logicalType: 'Microsoft.Sql/servers', location: 'westus2', subscription: mockSubscription },
    ],
};

const registryDetails: Record<string, object> = {
    'myDemoRegistry': {
        loginServer: 'mydemoregistry.azurecr.io',
        sku: { name: 'Standard', tier: 'Standard' },
        adminUserEnabled: true,
    },
    'stagingReg': {
        loginServer: 'stagingreg.azurecr.io',
        sku: { name: 'Basic', tier: 'Basic' },
        adminUserEnabled: false,
    },
};

// -- Mock providers -------------------------------------------------------

/**
 * Creates a mock {@link AzureSubscriptionProvider} that returns
 * hardcoded accounts, tenants, and subscriptions without any
 * authentication or network calls.
 */
export function createMockSubscriptionProvider(code: IVsCode): AzureSubscriptionProvider {
    const emitter = new code.EventEmitter<unknown>();
    return {
        onRefreshSuggested: emitter.event,
        signIn: () => Promise.resolve(true),
        getAccounts: () => Promise.resolve([mockAccount]),
        getAvailableSubscriptions: () => Promise.resolve([mockSubscription]),
        getUnauthenticatedTenantsForAccount: () => Promise.resolve([]),
        getTenantsForAccount: () => Promise.resolve([mockTenant]),
        getSubscriptionsForTenant: () => Promise.resolve([mockSubscription]),
    } as AzureSubscriptionProvider;
}

/**
 * Creates a mock {@link IResourceClientProvider} that returns
 * hardcoded resource groups and resources.
 */
export function createMockResourceClientProvider(): IResourceClientProvider {
    return () => Promise.resolve({
        resourceGroups: {
            list: () => resourceGroups,
        },
        resources: {
            listByResourceGroup: (rgName: string) => resourcesByGroup[rgName] ?? [],
        },
    } as unknown as IResourceClient);
}

/**
 * Creates a mock {@link IAcrClientProvider} that returns
 * hardcoded registry details for enrichment.
 */
export function createMockAcrClientProvider(): IAcrClientProvider {
    return () => Promise.resolve({
        registries: {
            get: (_rg: string, name: string) =>
                Promise.resolve(registryDetails[name] ?? { loginServer: '', sku: { name: 'Basic' }, adminUserEnabled: false }),
        },
    } as unknown as IAcrClient);
}
