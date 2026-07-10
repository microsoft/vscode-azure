/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Mock data setup for the "Extension: Run (Mock Data)" launch configuration.
//
// This file is compiled as a SEPARATE esbuild entry point (test/mock.bundle.js)
// so none of this code ends up in the main extension bundle.

import { IAcrClientProvider, IDeploymentClientProvider, IResourceClientProvider, ISubscriptionClientProvider } from '@microsoft/vscode-azure-azutils';
import { createMockAccountDataProvider, makeAccount, makeGenericResource, makeResourceGroup, makeSubscription, makeTenant } from '@microsoft/vscode-azure-azutils/testing';
import type { Container } from 'inversify';
import { createMockAcrClient } from '../tree/resources/acr/mockAcr';
import { createMockResourceClient } from '../tree/resources/mockResourceClient';
import type { ActivityStatus } from '../../src/tree/activity/Activity';
import { type AddChildOptions, ICodeDeploymentDataProvider } from '../../src/tree/activity/CodeDeploymentDataProvider';
import { IGenericActivityDataProvider } from '../../src/tree/activity/GenericActivityDataProvider';
import { IAzureAccountDataProvider } from '../../src/tree/resources/AzureAccountDataProvider';

// -- Mock data ----------------------------------------------------------------

const account = makeAccount({ id: 'mock-account', label: 'Mock Account' });
const tenant = makeTenant({ tenantId: 'mock-tenant', displayName: 'Mock Tenant', accountId: account.id });
const subscription = makeSubscription({
    subscriptionId: 'mock-sub-1',
    displayName: 'Mock Subscription',
    tenantId: tenant.tenantId,
    accountId: account.id,
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

// One generic activity per status.
const mockGenericActivities: ReadonlyArray<{ readonly status: ActivityStatus; readonly title: string }> = [
    { status: 'NotStarted', title: 'Waiting to start' },
    { status: 'InProgress', title: 'Provisioning resources' },
    { status: 'Completed', title: 'Deployment succeeded' },
    { status: 'Failed', title: 'Build failed' },
    { status: 'Canceled', title: 'User canceled' },
    { status: 'Info', title: 'No changes detected' },
    { status: 'Warn', title: 'Deprecated API version' },
];

// Code deployments with children. `complete` is applied after children are
// added to drive the deployment to a terminal state.
const mockCodeDeployments: ReadonlyArray<{
    readonly title: string;
    readonly children: readonly AddChildOptions[];
    readonly complete?: { readonly status: ActivityStatus; readonly error?: unknown };
}> = [
        {
            title: 'Deploy to staging',
            children: [
                { title: 'Upload artifacts', isLeaf: true },
                { title: 'Run migrations', isLeaf: true },
                { title: 'Restart services', status: 'InProgress', isLeaf: true },
            ],
        },
        {
            title: 'Deploy to production',
            children: [
                { title: 'Upload artifacts', isLeaf: true },
                { title: 'Run migrations', isLeaf: true },
                { title: 'Health check', isLeaf: true },
            ],
            complete: { status: 'Completed' },
        },
        {
            title: 'Deploy canary',
            children: [
                { title: 'Upload artifacts', isLeaf: true },
                { title: 'Run smoke tests', status: 'InProgress', isLeaf: true },
            ],
            complete: { status: 'Failed', error: new Error('Smoke test timeout') },
        },
    ];

// -- Public API ---------------------------------------------------------------

/**
 * Applies all mock-data overrides to the given container.
 *
 * Called from `main.js` after `setUpContainer` but before activation when
 * `AZURE_MOCK_DATA=1`.
 */
export function applyOverrides(container: Container): void {
    // -- Rebind Azure providers with mock implementations ---------------------

    container.rebind(IAzureAccountDataProvider).toConstantValue(
        createMockAccountDataProvider({
            accounts: [account],
            tenants: [tenant],
            subscriptions: [subscription],
        }),
    );

    container.rebind(IResourceClientProvider).toConstantValue(
        () => createMockResourceClient([demoRg, stagingRg], resourcesByGroup),
    );
    container.rebind(IAcrClientProvider).toConstantValue(
        () => createMockAcrClient(registryDetails),
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
        for (const activity of mockGenericActivities) {
            genericProvider.trackActivity(activity);
        }
        return genericProvider;
    });

    container.onActivation(ICodeDeploymentDataProvider, (_context, codeProvider) => {
        for (const { title, children, complete } of mockCodeDeployments) {
            const handle = codeProvider.trackDeployment({ title });
            for (const child of children) {
                handle.addChild(child);
            }
            if (complete) {
                handle.complete(complete.status, complete.error);
            }
        }
        return codeProvider;
    });
}
