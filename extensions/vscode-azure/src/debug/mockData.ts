/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Mock data setup for the "Extension: Run (Mock Data)" launch configuration.
//
// This file is compiled as a SEPARATE esbuild entry point (debug.bundle.mjs)
// so none of this code ends up in the main extension bundle.

import type { AzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import type { IDeploymentClientProvider, ISubscriptionClientProvider } from '@microsoft/vscode-azure-azutils';
import { makeAccount, makeGenericResource, makeResourceGroup, makeSubscription, makeTenant } from '@microsoft/vscode-azure-azutils/testing';
import type { IVsCode } from '@microsoft/vscode-azure-utils';
import type { Container } from 'inversify';
import { IAzureSubscriptionProvider, pushDisposable } from '../services';

// Service identifiers by their Symbol.for() keys. We avoid importing the
// const+type combos from azutils (e.g. `IAcrClientProvider`) because that
// would pull the full Azure SDK client modules into this debug bundle.
const SIVsCode = Symbol.for('IVsCode');
const SIResourceClientProvider = Symbol.for('IResourceClientProvider');
const SIDeploymentClientProvider = Symbol.for('IDeploymentClientProvider');
const SIAcrClientProvider = Symbol.for('IAcrClientProvider');
const SISubscriptionClientProvider = Symbol.for('ISubscriptionClientProvider');

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

function createMockSubscriptionProvider(code: IVsCode): AzureSubscriptionProvider {
    const emitter = new code.EventEmitter<unknown>();
    return {
        onRefreshSuggested: emitter.event,
        signIn: () => Promise.resolve(true),
        getAccounts: () => Promise.resolve([account]),
        getAvailableSubscriptions: () => Promise.resolve([subscription]),
        getUnauthenticatedTenantsForAccount: () => Promise.resolve([]),
        getTenantsForAccount: () => Promise.resolve([tenant]),
        getSubscriptionsForTenant: () => Promise.resolve([subscription]),
    } as unknown as AzureSubscriptionProvider;
}

function createMockResourceClientProvider() {
    return (() => Promise.resolve({
        resourceGroups: { list: () => [demoRg, stagingRg] },
        resources: { listByResourceGroup: (rgName: string) => resourcesByGroup[rgName] ?? [] },
    }));
}

function createMockAcrClientProvider() {
    return (() => Promise.resolve({
        registries: {
            get: (_rg: string, name: string) => Promise.resolve(
                registryDetails[name] ?? { loginServer: '', sku: { name: 'Basic' }, adminUserEnabled: false },
            ),
        },
    }));
}

// -- Public API ---------------------------------------------------------------

/**
 * Rebinds Azure providers on the given container with mock implementations.
 * Called from main.mjs when AZURE_MOCK_DATA=1.
 */
export function applyMockBindings(container: Container): void {
    const code = container.get<IVsCode>(SIVsCode);

    container.rebind(IAzureSubscriptionProvider).toDynamicValue(() => {
        return createMockSubscriptionProvider(code);
    }).inSingletonScope().onActivation(pushDisposable);

    container.rebind(SIResourceClientProvider).toConstantValue(createMockResourceClientProvider());
    container.rebind(SIAcrClientProvider).toConstantValue(createMockAcrClientProvider());

    container.rebind(SIDeploymentClientProvider).toConstantValue(
        (() => Promise.reject(new Error('Mock mode: deployments not available'))) as unknown as IDeploymentClientProvider,
    );
    container.rebind(SISubscriptionClientProvider).toConstantValue(
        (() => Promise.reject(new Error('Mock mode: subscription client not available'))) as unknown as ISubscriptionClientProvider,
    );
}
