/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Mock data setup for the "Extension: Run (Mock Data)" launch configuration.
//
// This file is loaded by main.mjs when AZURE_MOCK_DATA=1 is set. It is NOT
// processed by esbuild, so none of this code ends up in the production bundle.

// Service identifier symbols (must match the Symbol.for() strings in the source)
const IAzureSubscriptionProvider = Symbol.for('IAzureSubscriptionProvider');
const IResourceClientProvider = Symbol.for('IResourceClientProvider');
const IDeploymentClientProvider = Symbol.for('IDeploymentClientProvider');
const IAcrClientProvider = Symbol.for('IAcrClientProvider');
const ISubscriptionClientProvider = Symbol.for('ISubscriptionClientProvider');
const IVsCode = Symbol.for('IVsCode');

// -- Mock data ----------------------------------------------------------------

// Build a mock environment that inherits from AzureCloud (provides portalUrl, etc.)
// We can't use `import` for @azure/ms-rest-azure-env because this file is plain
// ESM loaded at runtime, but the package exposes a CJS export we can require.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Environment } = require('@azure/ms-rest-azure-env');
const mockEnvironment = Object.assign(Object.create(Environment.AzureCloud), {
    isCustomCloud: false,
});

const mockAccount = { id: 'mock-account', label: 'Mock Account', environment: mockEnvironment };
const mockTenant = { tenantId: 'mock-tenant', displayName: 'Mock Tenant', account: mockAccount };
const mockSubscription = {
    subscriptionId: 'mock-sub-1',
    tenantId: 'mock-tenant',
    name: 'Mock Subscription',
    account: mockAccount,
    environment: mockEnvironment,
    credential: { getToken: () => Promise.resolve({ token: 'mock', expiresOnTimestamp: Date.now() + 3600000 }) },
    isCustomCloud: false,
    authentication: { getSession: () => Promise.resolve(undefined) },
};

const resourceGroups = [
    { id: '/subscriptions/mock-sub-1/resourceGroups/demo-rg', name: 'demo-rg', type: 'Microsoft.Resources/resourceGroups', location: 'eastus', logicalType: 'Microsoft.Resources/resourceGroups', subscription: mockSubscription, groupingStrategy: 'resourceGroup', groupingValue: 'demo-rg' },
    { id: '/subscriptions/mock-sub-1/resourceGroups/staging-rg', name: 'staging-rg', type: 'Microsoft.Resources/resourceGroups', location: 'westus2', logicalType: 'Microsoft.Resources/resourceGroups', subscription: mockSubscription, groupingStrategy: 'resourceGroup', groupingValue: 'staging-rg' },
];

const resourcesByGroup = {
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

const registryDetails = {
    'myDemoRegistry': { loginServer: 'mydemoregistry.azurecr.io', sku: { name: 'Standard', tier: 'Standard' }, adminUserEnabled: true },
    'stagingReg': { loginServer: 'stagingreg.azurecr.io', sku: { name: 'Basic', tier: 'Basic' }, adminUserEnabled: false },
};

// -- Mock providers -----------------------------------------------------------

function createMockSubscriptionProvider(code) {
    const emitter = new code.EventEmitter();
    return {
        onRefreshSuggested: emitter.event,
        signIn: () => Promise.resolve(true),
        getAccounts: () => Promise.resolve([mockAccount]),
        getAvailableSubscriptions: () => Promise.resolve([mockSubscription]),
        getUnauthenticatedTenantsForAccount: () => Promise.resolve([]),
        getTenantsForAccount: () => Promise.resolve([mockTenant]),
        getSubscriptionsForTenant: () => Promise.resolve([mockSubscription]),
    };
}

function createMockResourceClientProvider() {
    return () => Promise.resolve({
        resourceGroups: { list: () => resourceGroups },
        resources: { listByResourceGroup: (rgName) => resourcesByGroup[rgName] ?? [] },
    });
}

function createMockAcrClientProvider() {
    return () => Promise.resolve({
        registries: {
            get: (_rg, name) => Promise.resolve(
                registryDetails[name] ?? { loginServer: '', sku: { name: 'Basic' }, adminUserEnabled: false },
            ),
        },
    });
}

// -- Public API ---------------------------------------------------------------

/**
 * Rebinds Azure providers on the given container with mock implementations.
 * Called from main.mjs when AZURE_MOCK_DATA=1.
 */
export function applyMockBindings(container) {
    const code = container.get(IVsCode);

    container.rebind(IAzureSubscriptionProvider).toConstantValue(createMockSubscriptionProvider(code));
    container.rebind(IResourceClientProvider).toConstantValue(createMockResourceClientProvider());
    container.rebind(IAcrClientProvider).toConstantValue(createMockAcrClientProvider());
    container.rebind(IDeploymentClientProvider).toConstantValue(
        () => Promise.reject(new Error('Mock mode: deployments not available')),
    );
    container.rebind(ISubscriptionClientProvider).toConstantValue(
        () => Promise.reject(new Error('Mock mode: subscription client not available')),
    );
}
