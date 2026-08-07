/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { collectPages } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import * as assert from 'node:assert';
import { AppServiceLogicalType, FunctionAppLogicalType, LogicAppLogicalType, ResourceClient } from '../../../src/rest/clients/ResourceClient';
import { makeCredential, makeSubscription } from '../../mockAzure';
import { makeResponse, MockHttpClient } from '../../mockPipeline';

describe('ResourceClient (unit)', () => {
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

    it('should prefer the newest stable API version when no default is available', async () => {
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

    it('should trim API version metadata before filtering, sorting, and preview detection', async () => {
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

    it('should use the newest preview API version when no stable version is available', async () => {
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
        await assert.rejects(
            createClient(missingProviderClient).providers.resolveApiVersion('Microsoft.Missing/widgets'),
            /Not found/,
        );

        const missingTypeClient = providerClient({ namespace: 'Microsoft.Example', resourceTypes: [] });
        await assert.rejects(
            createClient(missingTypeClient).providers.resolveApiVersion('Microsoft.Example/widgets'),
            /does not define resource type "widgets"/,
        );

        const missingVersionClient = providerClient({
            namespace: 'Microsoft.Example',
            resourceTypes: [{ resourceType: 'widgets', apiVersions: [] }],
        });
        await assert.rejects(
            createClient(missingVersionClient).providers.resolveApiVersion('Microsoft.Example/widgets'),
            /does not define an API version/,
        );
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

        await client.resources.deleteById(resourceId, { updateIntervalInMs: 0 });

        expect(pollCompleted).to.be.true;
        const deleteRequest = httpClient.requests.find(request => request.method === 'DELETE');
        expect(deleteRequest?.url).to.include(resourceId);
        expect(deleteRequest?.url).to.include('api-version=2024-04-01');
    });

    it('should delete a cross-provider extension resource using its provider metadata', async () => {
        const resourceId = '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Compute/virtualMachines/vm1/providers/Microsoft.Insights/diagnosticSettings/settings1';
        const httpClient = new MockHttpClient({
            handler: req => {
                if (req.method === 'GET' && req.url.includes('/providers/Microsoft.Insights?')) {
                    return makeResponse(req, 200, JSON.stringify({
                        namespace: 'Microsoft.Insights',
                        resourceTypes: [{ resourceType: 'diagnosticSettings', defaultApiVersion: '2021-05-01-preview' }],
                    }));
                } else if (req.method === 'DELETE') {
                    return makeResponse(req, 200);
                }

                return makeResponse(req, 404);
            },
        });
        const client = createClient(httpClient);

        await client.resources.deleteById(resourceId);

        const providerRequest = httpClient.requests.find(request => request.method === 'GET');
        expect(providerRequest?.url).to.include('/providers/Microsoft.Insights?');
        const deleteRequest = httpClient.requests.find(request => request.method === 'DELETE');
        expect(deleteRequest?.url).to.include(resourceId);
        expect(deleteRequest?.url).to.include('api-version=2021-05-01-preview');
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
