/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Mock data setup for the "Extension: Run (Mock Data)" launch configuration.
//
// This file is compiled as a SEPARATE esbuild entry point (debug.bundle.js)
// so none of this code ends up in the main extension bundle.

import { type IAcrClient, IAcrClientProvider, IDeploymentClientProvider, type IResourceClient, IResourceClientProvider, ISubscriptionClientProvider } from '@microsoft/vscode-azure-azutils';
import { createMockSubscriptionProvider, makeAccount, makeGenericResource, makeResourceGroup, makeSubscription, makeTenant } from '@microsoft/vscode-azure-azutils/testing';
import type { Container } from 'inversify';
import { IAzureSubscriptionProvider } from '../services';
import { ICodeDeploymentDataProvider } from '../tree/activity/CodeDeploymentDataProvider';
import { IGenericActivityDataProvider } from '../tree/activity/GenericActivityDataProvider';

// -- Mock data ----------------------------------------------------------------

const account = makeAccount({ id: 'mock-account', label: 'Mock Account' });
const tenant = makeTenant({ tenantId: 'mock-tenant', displayName: 'Mock Tenant', account });
const subscription = makeSubscription({
    subscriptionId: 'mock-sub-1',
    name: 'Mock Subscription',
    account,
});

const subscriptionIdPrefix = `/subscriptions/${subscription.subscriptionId}`;
const rgIdPrefix = (rgName: string) => `${subscriptionIdPrefix}/resourceGroups/${rgName}`;
const resourceId = (rgName: string, resourceType: string, resourceName: string) =>
    `${rgIdPrefix(rgName)}/providers/${resourceType}/${resourceName}`;

const demoRg = makeResourceGroup({
    id: rgIdPrefix('demo-rg'),
    name: 'demo-rg',
    subscription,
});

const stagingRg = makeResourceGroup({
    id: rgIdPrefix('staging-rg'),
    name: 'staging-rg',
    location: 'westus2',
    subscription,
});

const resourcesByGroup: Record<string, unknown[]> = {
    'demo-rg': [
        makeGenericResource({ id: resourceId('demo-rg', 'Microsoft.ContainerRegistry/registries', 'myDemoRegistry'), name: 'myDemoRegistry', type: 'Microsoft.ContainerRegistry/registries', logicalType: 'Microsoft.ContainerRegistry/registries', subscription }),
        makeGenericResource({ id: resourceId('demo-rg', 'Microsoft.Web/sites', 'demo-webapp'), name: 'demo-webapp', type: 'Microsoft.Web/sites', logicalType: 'Microsoft.Web/sites', subscription }),
        makeGenericResource({ id: resourceId('demo-rg', 'Microsoft.Storage/storageAccounts', 'demostorage'), name: 'demostorage', type: 'Microsoft.Storage/storageAccounts', logicalType: 'Microsoft.Storage/storageAccounts', subscription }),
    ],
    'staging-rg': [
        makeGenericResource({ id: resourceId('staging-rg', 'Microsoft.ContainerRegistry/registries', 'stagingReg'), name: 'stagingReg', type: 'Microsoft.ContainerRegistry/registries', logicalType: 'Microsoft.ContainerRegistry/registries', location: 'westus2', subscription }),
        makeGenericResource({ id: resourceId('staging-rg', 'Microsoft.Sql/servers', 'staging-sql'), name: 'staging-sql', type: 'Microsoft.Sql/servers', logicalType: 'Microsoft.Sql/servers', location: 'westus2', subscription }),
    ],
};

const registryDetails: Record<string, { loginServer: string; sku: { name: string; tier: string }; adminUserEnabled: boolean }> = {
    'myDemoRegistry': { loginServer: 'mydemoregistry.azurecr.io', sku: { name: 'Standard', tier: 'Standard' }, adminUserEnabled: true },
    'stagingReg': { loginServer: 'stagingreg.azurecr.io', sku: { name: 'Basic', tier: 'Basic' }, adminUserEnabled: false },
};

// -- Mock providers -----------------------------------------------------------

/** Creates an {@linkcode IResourceClient} that returns fixed resource groups and resources. */
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
 * Creates an {@linkcode IAcrClient} whose `registries.get()` returns canned
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
 * Called from `main.js` before activation when `AZURE_MOCK_DATA=1`.
 */
export function preApply(container: Container): void {
    container.rebind(IAzureSubscriptionProvider).toConstantValue(
        createMockSubscriptionProvider({
            accounts: [account],
            tenants: [tenant],
            subscriptions: [subscription],
        }),
    );

    container.rebind(IResourceClientProvider).toConstantValue(
        () => Promise.resolve(createMockResourceClient()),
    );
    container.rebind(IAcrClientProvider).toConstantValue(
        () => Promise.resolve(createMockAcrClient()),
    );

    container.rebind(IDeploymentClientProvider).toConstantValue(
        () => Promise.reject(new Error('Mock mode: deployments not available')),
    );
    container.rebind(ISubscriptionClientProvider).toConstantValue(
        () => Promise.reject(new Error('Mock mode: subscription client not available')),
    );
}

/**
 * Seeds the activity tree with sample data.
 * Called from `main.js` after activation when `AZURE_MOCK_DATA=1`.
 */
export function postApply(container: Container): void {
    const genericProvider = container.get(IGenericActivityDataProvider);
    const codeProvider = container.get(ICodeDeploymentDataProvider);

    // Generic activities -- one per status
    genericProvider.trackActivity({ id: 'mock-not-started', status: 'NotStarted', title: 'Waiting to start' });
    genericProvider.trackActivity({ id: 'mock-in-progress', status: 'InProgress', title: 'Provisioning resources' });
    genericProvider.trackActivity({ id: 'mock-completed', status: 'Completed', title: 'Deployment succeeded' });
    genericProvider.trackActivity({ id: 'mock-failed', status: 'Failed', title: 'Build failed' });
    genericProvider.trackActivity({ id: 'mock-canceled', status: 'Canceled', title: 'User canceled' });
    genericProvider.trackActivity({ id: 'mock-info', status: 'Info', title: 'No changes detected' });
    genericProvider.trackActivity({ id: 'mock-warn', status: 'Warn', title: 'Deprecated API version' });

    // Code deployment with children
    const deploy = codeProvider.trackDeployment({ title: 'Deploy to staging' });
    deploy.addChild('Upload artifacts');
    deploy.addChild('Run migrations');
    deploy.addChild('Restart services', 'InProgress');

    // Completed code deployment
    const doneDeploy = codeProvider.trackDeployment({ title: 'Deploy to production' });
    doneDeploy.addChild('Upload artifacts');
    doneDeploy.addChild('Run migrations');
    doneDeploy.addChild('Health check');
    doneDeploy.complete('Completed');

    // Failed code deployment
    const failedDeploy = codeProvider.trackDeployment({ title: 'Deploy canary' });
    failedDeploy.addChild('Upload artifacts');
    failedDeploy.addChild('Run smoke tests', 'InProgress');
    failedDeploy.complete('Failed', new Error('Smoke test timeout'));
}
