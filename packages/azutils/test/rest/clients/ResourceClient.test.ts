/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { collectPages, delay } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { AppServiceLogicalType, FunctionAppLogicalType, LogicAppLogicalType, ResourceClient, StaticWebAppResourceType } from '../../../src/rest/clients/ResourceClient';
import { makeCredential, makeSubscription } from '../../mockAzure';
import { makeResponse, MockHttpClient } from '../../mockPipeline';

describe('ResourceClient (unit)', () => {
    it('should isolate concurrent requests from clients with custom options', async () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const subscription = makeSubscription();
        const body = JSON.stringify({ value: [] });
        const httpClient = new MockHttpClient({
            handler: async (request) => {
                await delay(10);
                return makeResponse(request, 200, body);
            },
        });
        const client1 = ResourceClient.create(ctx, executor, makeCredential(), subscription, { httpClient });
        const client2 = ResourceClient.create(ctx, executor, makeCredential(), subscription, { httpClient });

        await Promise.all([
            collectPages(client1.resourceGroups.list()),
            collectPages(client2.resourceGroups.list()),
        ]);

        expect(httpClient.requests).to.have.length(2);
    });

    it('should list resource groups with metadata attached', async () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const subscription = makeSubscription();

        const rgBody = JSON.stringify({
            value: [
                { id: '/subscriptions/test-sub/resourceGroups/rg1', name: 'rg1', type: 'Microsoft.Resources/resourceGroups', location: 'eastus' },
                { id: '/subscriptions/test-sub/resourceGroups/rg2', name: 'rg2', type: 'Microsoft.Resources/resourceGroups', location: 'westus' },
            ],
        });

        const httpClient = new MockHttpClient({
            handler: (req) => makeResponse(req, 200, rgBody),
        });

        const client = ResourceClient.create(ctx, executor, makeCredential(), subscription, { httpClient });
        const pages = await collectPages(client.resourceGroups.list());

        expect(pages).to.have.length(1);
        const rgs = pages[0].items;
        expect(rgs).to.have.length(2);
        expect(rgs[0].name).to.equal('rg1');
        expect(rgs[0].groupingStrategy).to.equal('resourceGroup');
        expect(rgs[0].groupingValue).to.equal('rg1');
        expect(rgs[0].subscription).to.equal(subscription);
    });

    it('should list resources with logicalType attached', async () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const subscription = makeSubscription();

        const resourcesBody = JSON.stringify({
            value: [
                { id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Storage/storageAccounts/sa1', name: 'sa1', type: 'Microsoft.Storage/storageAccounts', location: 'eastus' },
            ],
        });

        const httpClient = new MockHttpClient({
            handler: (req) => makeResponse(req, 200, resourcesBody),
        });

        const client = ResourceClient.create(ctx, executor, makeCredential(), subscription, { httpClient });
        const pages = await collectPages(client.resources.listByResourceGroup('rg1'));

        expect(pages).to.have.length(1);
        const resources = pages[0].items;
        expect(resources).to.have.length(1);
        expect(resources[0].name).to.equal('sa1');
        expect(resources[0].logicalType).to.equal('Microsoft.Storage/storageAccounts');
        expect(resources[0].subscription).to.equal(subscription);
    });

    it('should map Microsoft.Web/sites with functionapp kind to FunctionApp logicalType', async () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const subscription = makeSubscription();

        const resourcesBody = JSON.stringify({
            value: [
                { id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Web/sites/fn1', name: 'fn1', type: 'Microsoft.Web/sites', kind: 'functionapp', location: 'eastus' },
                { id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Web/sites/wf1', name: 'wf1', type: 'Microsoft.Web/sites', kind: 'functionapp,workflowapp', location: 'eastus' },
                { id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Web/sites/app1', name: 'app1', type: 'Microsoft.Web/sites', kind: 'app', location: 'eastus' },
            ],
        });

        const httpClient = new MockHttpClient({
            handler: (req) => makeResponse(req, 200, resourcesBody),
        });

        const client = ResourceClient.create(ctx, executor, makeCredential(), subscription, { httpClient });
        const pages = await collectPages(client.resources.listByResourceGroup('rg1'));

        const resources = pages[0].items;
        expect(resources[0].logicalType).to.equal(FunctionAppLogicalType);
        expect(resources[1].logicalType).to.equal(LogicAppLogicalType);
        expect(resources[2].logicalType).to.equal(AppServiceLogicalType);
    });

    it('should preserve the Static Web Apps ARM type as its logical type', async () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const subscription = makeSubscription();

        const resourcesBody = JSON.stringify({
            value: [
                {
                    id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Web/staticSites/swa1',
                    name: 'swa1',
                    type: StaticWebAppResourceType,
                    location: 'eastus2',
                },
            ],
        });
        const httpClient = new MockHttpClient({
            handler: (req) => makeResponse(req, 200, resourcesBody),
        });

        const client = ResourceClient.create(ctx, executor, makeCredential(), subscription, { httpClient });
        const pages = await collectPages(client.resources.listByResourceGroup('rg1'));

        expect(pages[0].items[0].logicalType).to.equal(StaticWebAppResourceType);
    });

    it('should set hasMore based on nextLink presence', async () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const subscription = makeSubscription();

        let callCount = 0;
        const httpClient = new MockHttpClient({
            handler: (req) => {
                callCount++;
                if (callCount === 1) {
                    return makeResponse(req, 200, JSON.stringify({
                        value: [{ id: '/subscriptions/test-sub/resourceGroups/rg1', name: 'rg1', type: 'Microsoft.Resources/resourceGroups', location: 'eastus' }],
                        nextLink: 'https://management.azure.com/next',
                    }));
                }
                return makeResponse(req, 200, JSON.stringify({
                    value: [{ id: '/subscriptions/test-sub/resourceGroups/rg2', name: 'rg2', type: 'Microsoft.Resources/resourceGroups', location: 'westus' }],
                }));
            },
        });

        const client = ResourceClient.create(ctx, executor, makeCredential(), subscription, { httpClient });
        const pages = await collectPages(client.resourceGroups.list());

        expect(pages).to.have.length(2);
        expect(pages[0].hasMore).to.be.true;
        expect(pages[1].hasMore).to.be.false;
    });

    it('should prefer the provider resource type default API version using case-insensitive nested matching', async () => {
        const httpClient = providerClient({
            namespace: 'Microsoft.Web',
            resourceTypes: [{
                resourceType: 'sites/slots',
                defaultApiVersion: '2024-04-01',
                apiVersions: ['2025-01-01-preview', '2023-01-01'],
            }],
        });
        const client = createClient(httpClient);

        const apiVersion = await client.providers.resolveApiVersion('microsoft.web/SITES/SLOTS');

        expect(apiVersion).to.equal('2024-04-01');
    });

    it('should prefer the newest stable API version over newer previews', async () => {
        const httpClient = providerClient({
            namespace: 'Microsoft.Storage',
            resourceTypes: [{
                resourceType: 'storageAccounts',
                apiVersions: ['2025-06-01-preview', '2023-01-01', '2024-01-01', '2024-06-01-preview'],
            }],
        });
        const client = createClient(httpClient);

        expect(await client.providers.resolveApiVersion('Microsoft.Storage/storageAccounts')).to.equal('2024-01-01');
    });

    it('should fall back to the newest preview when no stable version exists', async () => {
        const httpClient = providerClient({
            namespace: 'Microsoft.Example',
            resourceTypes: [{
                resourceType: 'widgets',
                apiVersions: ['2023-01-01-preview', '2025-01-01-preview', '2024-01-01-preview'],
            }],
        });
        const client = createClient(httpClient);

        expect(await client.providers.resolveApiVersion('Microsoft.Example/widgets')).to.equal('2025-01-01-preview');
    });

    it('should trim API version metadata before filtering and sorting', async () => {
        const httpClient = providerClient({
            namespace: 'Microsoft.Example',
            resourceTypes: [{
                resourceType: 'widgets',
                apiVersions: [' 2025-06-01-preview ', '   ', ' 2023-01-01 ', '2024-01-01  '],
            }],
        });
        const client = createClient(httpClient);

        expect(await client.providers.resolveApiVersion('Microsoft.Example/widgets')).to.equal('2024-01-01');
    });

    it('should cache resolved API versions per client and normalized resource type', async () => {
        const httpClient = providerClient({
            namespace: 'Microsoft.Example',
            resourceTypes: [{ resourceType: 'widgets', defaultApiVersion: '2024-01-01' }],
        });
        const client = createClient(httpClient);

        await client.providers.resolveApiVersion('Microsoft.Example/widgets');
        await client.providers.resolveApiVersion('microsoft.example/WIDGETS');

        expect(httpClient.requests).to.have.length(1);
    });

    it('should fail when the provider, resource type, or API version is unavailable', async () => {
        const missingProviderClient = new MockHttpClient({
            handler: req => makeResponse(req, 404, JSON.stringify({ error: { code: 'NotFound', message: 'Not found' } })),
        });
        await expect(createClient(missingProviderClient).providers.resolveApiVersion('Microsoft.Missing/widgets'))
            .to.be.rejectedWith(/Not found/);

        const missingTypeClient = providerClient({ namespace: 'Microsoft.Example', resourceTypes: [] });
        await expect(createClient(missingTypeClient).providers.resolveApiVersion('Microsoft.Example/widgets'))
            .to.be.rejectedWith(/does not define resource type "widgets"/);

        const missingVersionClient = providerClient({
            namespace: 'Microsoft.Example',
            resourceTypes: [{ resourceType: 'widgets', apiVersions: [] }],
        });
        await expect(createClient(missingVersionClient).providers.resolveApiVersion('Microsoft.Example/widgets'))
            .to.be.rejectedWith(/does not define an API version/);
    });

    it('should delete a nested resource by ID and await LRO completion', async () => {
        const resourceId = '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Web/sites/app1/slots/staging';
        let pollCompleted = false;
        const httpClient = new MockHttpClient({
            handler: req => {
                if (req.method === 'GET' && req.url.includes('/providers/Microsoft.Web?')) {
                    return makeResponse(req, 200, JSON.stringify({
                        namespace: 'Microsoft.Web',
                        resourceTypes: [{ resourceType: 'sites/slots', defaultApiVersion: '2024-04-01' }],
                    }));
                } else if (req.method === 'DELETE') {
                    return makeResponse(req, 202, undefined, { location: 'https://management.azure.com/operations/delete-resource' });
                }

                pollCompleted = true;
                return makeResponse(req, 200);
            },
        });
        const client = createClient(httpClient);

        await client.resources.deleteById(resourceId, 'Microsoft.Web/sites/slots', { updateIntervalInMs: 0 });

        expect(pollCompleted).to.be.true;
        const deleteRequest = httpClient.requests.find(request => request.method === 'DELETE');
        expect(deleteRequest?.url).to.include(resourceId);
        expect(deleteRequest?.url).to.include('api-version=2024-04-01');
    });

    it('should delete a resource group and await LRO completion', async () => {
        let pollCompleted = false;
        const httpClient = new MockHttpClient({
            handler: req => {
                if (req.method === 'DELETE') {
                    return makeResponse(req, 202, undefined, { location: 'https://management.azure.com/operations/delete-resource-group' });
                }

                pollCompleted = true;
                return makeResponse(req, 200);
            },
        });
        const client = createClient(httpClient);

        await client.resourceGroups.delete('rg1', { updateIntervalInMs: 0 });

        expect(pollCompleted).to.be.true;
        const deleteRequest = httpClient.requests.find(request => request.method === 'DELETE');
        expect(deleteRequest?.url.toLowerCase()).to.include('/subscriptions/test-sub/resourcegroups/rg1');
    });
});

function createClient(httpClient: MockHttpClient): ResourceClient {
    const { ctx } = createMockCodeContext();
    const { executor } = createTestActionExecutor();
    return ResourceClient.create(ctx, executor, makeCredential(), makeSubscription(), { httpClient });
}

function providerClient(provider: object): MockHttpClient {
    return new MockHttpClient({
        handler: req => makeResponse(req, 200, JSON.stringify(provider)),
    });
}
