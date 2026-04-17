/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Mock data setup for the "Extension: Run (Mock Data)" launch configuration.
//
// This file is compiled as a SEPARATE esbuild entry point (debug.bundle.mjs)
// so none of this code ends up in the main extension bundle.

import type { AzureSubscriptionProvider, AzureSubscription, AzureTenant } from '@microsoft/vscode-azext-azureauth';
import { type IAcrClient, IAcrClientProvider, IDeploymentClientProvider, type IResourceClient, IResourceClientProvider, ISubscriptionClientProvider } from '@microsoft/vscode-azure-azutils';
import { makeAccount, makeGenericResource, makeResourceGroup, makeSubscription, makeTenant } from '@microsoft/vscode-azure-azutils/testing';
import { EventEmitter } from '@microsoft/vscode-azure-utils';
import type { Container } from 'inversify';
import { IAzureSubscriptionProvider } from '../services';

// -- Mock data ----------------------------------------------------------------

const account = makeAccount({ id: 'mock-account', label: 'Mock Account' });
const tenant = makeTenant({ tenantId: 'mock-tenant', displayName: 'Mock Tenant', account });
const subscription = makeSubscription({
    subscriptionId: 'mock-sub-1',
    name: 'Mock Subscription',
    account,
});

const demoRg = makeResourceGroup({
    name: 'demo-rg',
    subscription,
});

const stagingRg = makeResourceGroup({
    id: '/subscriptions/mock-sub-1/resourceGroups/staging-rg',
    name: 'staging-rg',
    location: 'westus2',
    subscription,
});

const resourcesByGroup: Record<string, unknown[]> = {
    'demo-rg': [
        makeGenericResource({ name: 'myDemoRegistry', type: 'Microsoft.ContainerRegistry/registries', logicalType: 'Microsoft.ContainerRegistry/registries', subscription }),
        makeGenericResource({ name: 'demo-webapp', type: 'Microsoft.Web/sites', logicalType: 'Microsoft.Web/sites', subscription }),
        makeGenericResource({ name: 'demostorage', type: 'Microsoft.Storage/storageAccounts', logicalType: 'Microsoft.Storage/storageAccounts', subscription }),
    ],
    'staging-rg': [
        makeGenericResource({ name: 'stagingReg', type: 'Microsoft.ContainerRegistry/registries', logicalType: 'Microsoft.ContainerRegistry/registries', location: 'westus2', subscription }),
        makeGenericResource({ name: 'staging-sql', type: 'Microsoft.Sql/servers', logicalType: 'Microsoft.Sql/servers', location: 'westus2', subscription }),
    ],
};

const registryDetails: Record<string, { loginServer: string; sku: { name: string; tier: string }; adminUserEnabled: boolean }> = {
    'myDemoRegistry': { loginServer: 'mydemoregistry.azurecr.io', sku: { name: 'Standard', tier: 'Standard' }, adminUserEnabled: true },
    'stagingReg': { loginServer: 'stagingreg.azurecr.io', sku: { name: 'Basic', tier: 'Basic' }, adminUserEnabled: false },
};

// -- Mock providers -----------------------------------------------------------

/** Options for overriding {@linkcode createMockSubscriptionProvider} defaults. */
export interface MockSubscriptionProviderOptions {
    readonly accounts?: AzureSubscriptionProvider['getAccounts'] extends () => Promise<infer T> ? T : never;
    readonly tenants?: AzureTenant[];
    readonly subscriptions?: AzureSubscription[];
}

/** Creates an in-memory {@linkcode AzureSubscriptionProvider} backed by canned account/tenant/subscription data. */
export function createMockSubscriptionProvider(options?: MockSubscriptionProviderOptions): AzureSubscriptionProvider {
    const accounts = options?.accounts ?? [account];
    const tenants = options?.tenants ?? [tenant];
    const subscriptions = options?.subscriptions ?? [subscription];
    const emitter = new EventEmitter<unknown>();
    return {
        onRefreshSuggested: emitter.event,
        signIn: () => Promise.resolve(true),
        getAccounts: () => Promise.resolve(accounts),
        getAvailableSubscriptions: () => Promise.resolve(subscriptions),
        getUnauthenticatedTenantsForAccount: () => Promise.resolve([]),
        getTenantsForAccount: () => Promise.resolve(tenants),
        getSubscriptionsForTenant: () => Promise.resolve(subscriptions),
    } as unknown as AzureSubscriptionProvider;
}

/** Creates an `IResourceClient` that returns fixed resource groups and resources. */
export function createMockResourceClient(
    resourceGroups: unknown[] = [demoRg, stagingRg],
    resourcesByRg: Record<string, unknown[]> | unknown[] = resourcesByGroup,
): IResourceClient {
    return {
        resourceGroups: { list: () => resourceGroups },
        resources: {
            listByResourceGroup: Array.isArray(resourcesByRg)
                ? () => resourcesByRg
                : (rgName: string) => resourcesByRg[rgName] ?? [],
        },
    } as unknown as IResourceClient;
}

/**
 * Creates an `IAcrClient` whose `registries.get()` returns canned
 * details for the mock registries. Additional top-level methods can
 * be supplied via {@linkcode overrides}.
 */
export function createMockAcrClient(overrides?: Record<string, unknown>): IAcrClient {
    return {
        registries: {
            get: (_rg: string, name: string) => Promise.resolve(
                registryDetails[name] ?? { loginServer: '', sku: { name: 'Basic' }, adminUserEnabled: false },
            ),
        },
        ...overrides,
    } as unknown as IAcrClient;
}

// -- Public API ---------------------------------------------------------------

/**
 * Rebinds Azure providers on the given container with mock implementations.
 * Called from main.mjs when AZURE_MOCK_DATA=1.
 */
export function applyMockBindings(container: Container): void {
    container.rebind(IAzureSubscriptionProvider).toConstantValue(
        createMockSubscriptionProvider(),
    );

    container.rebind(IResourceClientProvider).toConstantValue(
        (() => Promise.resolve(createMockResourceClient())) as unknown as IResourceClientProvider,
    );
    container.rebind(IAcrClientProvider).toConstantValue(
        (() => Promise.resolve(createMockAcrClient())) as unknown as IAcrClientProvider,
    );

    container.rebind(IDeploymentClientProvider).toConstantValue(
        (() => Promise.reject(new Error('Mock mode: deployments not available'))) as unknown as IDeploymentClientProvider,
    );
    container.rebind(ISubscriptionClientProvider).toConstantValue(
        (() => Promise.reject(new Error('Mock mode: subscription client not available'))) as unknown as ISubscriptionClientProvider,
    );
}
