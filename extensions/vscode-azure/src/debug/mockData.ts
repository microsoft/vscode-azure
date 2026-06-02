/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Mock data setup for the "Extension: Run (Mock Data)" launch configuration.
//
// This file is compiled as a SEPARATE esbuild entry point (debug.bundle.js)
// so none of this code ends up in the main extension bundle.

import { IAcrClientProvider, IDeploymentClientProvider, IResourceClientProvider, ISubscriptionClientProvider } from '@microsoft/vscode-azure-azutils';
import { createMockSubscriptionProvider, makeAccount, makeGenericResource, makeResourceGroup, makeSubscription, makeTenant } from '@microsoft/vscode-azure-azutils/testing';
import type { Container } from 'inversify';
import { IAzureSubscriptionProvider } from '../services';
import { createMockAcrClient } from '../test/tree/resources/acr/mockAcr';
import { createMockResourceClient } from '../test/tree/resources/mockResourceClient';
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
        makeGenericResource({ id: resourceId('demo-rg', 'Microsoft.Web/sites', 'demo-webapp'), name: 'demo-webapp', type: 'Microsoft.Web/sites', logicalType: 'Microsoft.Web/sites~app', subscription }),
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

// -- Public API ---------------------------------------------------------------

/**
 * Applies all mock-data overrides to the given container.
 *
 * Called from `main.js` after `setUpContainer` but before activation when
 * `AZURE_MOCK_DATA=1`. It does two things:
 *
 * 1. Rebinds the Azure provider services with mock implementations so the
 *    tree views render deterministic fake data instead of hitting the network.
 * 2. Registers activation hooks that seed the activity tree with sample data
 *    once the activity providers are constructed during activation.
 */
export function applyMockData(container: Container): void {
    // -- Rebind Azure providers with mock implementations ---------------------

    container.rebind(IAzureSubscriptionProvider).toConstantValue(
        createMockSubscriptionProvider({
            accounts: [account],
            tenants: [tenant],
            subscriptions: [subscription],
        }),
    );

    container.rebind(IResourceClientProvider).toConstantValue(
        () => Promise.resolve(createMockResourceClient([demoRg, stagingRg], resourcesByGroup)),
    );
    container.rebind(IAcrClientProvider).toConstantValue(
        () => createMockAcrClient({
            registries: {
                get: (_rg: string, name: string) => Promise.resolve(
                    registryDetails[name] ?? { loginServer: '', sku: { name: 'Basic' }, adminUserEnabled: false },
                ),
            },
        }),
    );

    container.rebind(IDeploymentClientProvider).toConstantValue(
        () => { throw new Error('Mock mode: deployments not available'); },
    );
    container.rebind(ISubscriptionClientProvider).toConstantValue(
        () => { throw new Error('Mock mode: subscription client not available'); },
    );

    // -- Seed the activity tree with sample data ------------------------------
    //
    // The activity providers are bound during activation, so register
    // activation hooks that seed them as soon as they are constructed.

    container.onActivation(IGenericActivityDataProvider, (_context, genericProvider) => {
        // Generic activities -- one per status
        genericProvider.trackActivity({ id: 'mock-not-started', status: 'NotStarted', title: 'Waiting to start' });
        genericProvider.trackActivity({ id: 'mock-in-progress', status: 'InProgress', title: 'Provisioning resources' });
        genericProvider.trackActivity({ id: 'mock-completed', status: 'Completed', title: 'Deployment succeeded' });
        genericProvider.trackActivity({ id: 'mock-failed', status: 'Failed', title: 'Build failed' });
        genericProvider.trackActivity({ id: 'mock-canceled', status: 'Canceled', title: 'User canceled' });
        genericProvider.trackActivity({ id: 'mock-info', status: 'Info', title: 'No changes detected' });
        genericProvider.trackActivity({ id: 'mock-warn', status: 'Warn', title: 'Deprecated API version' });
        return genericProvider;
    });

    container.onActivation(ICodeDeploymentDataProvider, (_context, codeProvider) => {
        // Code deployment with children
        const deploy = codeProvider.trackDeployment({ title: 'Deploy to staging' });
        deploy.addChild({ title: 'Upload artifacts', isLeaf: true });
        deploy.addChild({ title: 'Run migrations', isLeaf: true });
        deploy.addChild({ title: 'Restart services', status: 'InProgress', isLeaf: true });

        // Completed code deployment
        const doneDeploy = codeProvider.trackDeployment({ title: 'Deploy to production' });
        doneDeploy.addChild({ title: 'Upload artifacts', isLeaf: true });
        doneDeploy.addChild({ title: 'Run migrations', isLeaf: true });
        doneDeploy.addChild({ title: 'Health check', isLeaf: true });
        doneDeploy.complete('Completed');

        // Failed code deployment
        const failedDeploy = codeProvider.trackDeployment({ title: 'Deploy canary' });
        failedDeploy.addChild({ title: 'Upload artifacts', isLeaf: true });
        failedDeploy.addChild({ title: 'Run smoke tests', status: 'InProgress', isLeaf: true });
        failedDeploy.complete('Failed', new Error('Smoke test timeout'));
        return codeProvider;
    });
}
