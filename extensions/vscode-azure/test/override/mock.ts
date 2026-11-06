/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Mock data setup for the "Extension: Run (Mock Data)" launch configuration.
//
// This file is compiled as a SEPARATE esbuild entry point (test/mock.bundle.js)
// so none of this code ends up in the main extension bundle.

import { IAcrClientProvider, IAzureListingFetcher, ICredentialFactory, IDeploymentClientProvider, IResourceClientProvider, ISubscriptionClientProvider, IWebAppClientProvider, type AzureTenant } from '@microsoft/vscode-azure-azutils';
import { createMockAzureListingFetcher, createMockCredentialFactory, createMockWebAppClient, makeAccount, makeGenericResource, makeResourceGroup, makeSubscription, makeTenant } from '@microsoft/vscode-azure-azutils/testing';
import type { Container } from 'inversify';
import { createMockAcrClient } from '../tree/resources/acr/mockAcr';
import { createMockResourceClient } from '../tree/resources/mockResourceClient';
import type { ActivityStatus } from '../../src/tree/activity/Activity';
import { type AddChildOptions, ICodeDeploymentDataProvider } from '../../src/tree/activity/CodeDeploymentDataProvider';
import { IGenericActivityDataProvider } from '../../src/tree/activity/GenericActivityDataProvider';

// -- Mock data ----------------------------------------------------------------

const account = makeAccount({ id: 'mock-account', label: 'Mock Account' });
const tenant = makeTenant({ tenantId: 'mock-tenant', displayName: 'Mock Tenant', accountId: account.id });
const subscription = makeSubscription({
    subscriptionId: 'mock-sub-1',
    displayName: 'Mock Subscription',
    tenantId: tenant.tenantId,
    accountId: account.id,
});

// A second account whose tenants cannot be enumerated, standing in for an
// account behind conditional access. It shows up signed in but empty, which is
// the state that makes `Azure: Sign In` offer to sign in to a tenant by id --
// the one path that reaches a tenant Azure will not list. Whatever tenant id is
// entered is persisted to `vscode-azure.signedInTenants`, folded back into this
// account's listing below, and given a subscription of its own so it can be
// drilled like any other.
const restrictedAccount = makeAccount({ id: 'mock-account-restricted', label: 'Mock Account (Conditional Access)' });

/** Every subscription the mock fetcher serves. Grows as tenants are entered by hand. */
const subscriptions = [subscription];

/**
 * Give a manually-entered tenant a subscription, once. Called each time the
 * restricted account's tenants are listed, since the tenant is not known until
 * the user types its id.
 */
function ensureSubscriptionFor(accountId: string, tenantId: string): void {
    if (subscriptions.some(sub => sub.accountId === accountId && sub.tenantId === tenantId)) {
        return;
    }
    subscriptions.push(makeSubscription({
        subscriptionId: `mock-sub-${tenantId.slice(0, 8)}`,
        displayName: `Mock Subscription (${tenantId.slice(0, 8)})`,
        tenantId,
        accountId,
    }));
}

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

    // Rebinding the fetcher (rather than the data provider above it) keeps the
    // real cache, filter, and tree wiring in the loop, so mock mode exercises
    // the same code paths -- including flows that read the cache directly, such
    // as Select Subscriptions, and the merging of manually-entered tenants,
    // which the real cache does over whatever this fetcher lists.
    const listingFetcher = createMockAzureListingFetcher({
        accounts: [account, restrictedAccount],
        tenants: [tenant],
        subscriptions,
        unlistableAccountIds: [restrictedAccount.id],
    });

    container.rebind(IAzureListingFetcher).toConstantValue({
        ...listingFetcher,
        // A manually-entered tenant is not in the canned data, so give it a
        // subscription the moment something lists it. Doing so here rather than
        // up front means the fixture only invents subscriptions for tenants the
        // user actually signed in to.
        fetchSubscriptions: (forTenant: AzureTenant) => {
            ensureSubscriptionFor(forTenant.accountId, forTenant.tenantId);
            return listingFetcher.fetchSubscriptions(forTenant);
        },
    } satisfies IAzureListingFetcher);

    // Sign-in flows ask the credential factory for a session directly, so mock
    // mode needs one that resolves without VS Code's authentication provider --
    // otherwise `Azure: Sign In` prompts for a real account. A tenant entered by
    // hand carries no account context, so it resolves to the restricted account:
    // the one whose tenants cannot be listed, and therefore the only one a
    // tenant id has to be entered for.
    //
    // Silent acquisition is denied because there is no cached session behind
    // this factory. That is what a manually-entered tenant's name enrichment
    // asks for, so the tenant keeps showing its id -- the same outcome as a real
    // session that conditional access still will not let list tenants.
    container.rebind(ICredentialFactory).toConstantValue(
        createMockCredentialFactory({ account: restrictedAccount, denySilentAcquisition: true }),
    );

    container.rebind(IResourceClientProvider).toConstantValue(
        () => createMockResourceClient([demoRg, stagingRg], resourcesByGroup),
    );
    container.rebind(IAcrClientProvider).toConstantValue(
        () => createMockAcrClient(registryDetails),
    );
    container.rebind(IWebAppClientProvider).toConstantValue(
        () => createMockWebAppClient({ defaultHostName: 'demo-webapp.azurewebsites.net' }),
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
