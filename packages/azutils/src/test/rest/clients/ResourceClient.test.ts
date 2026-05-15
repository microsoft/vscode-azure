/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { AppServiceLogicalType, FunctionAppLogicalType, LogicAppLogicalType, ResourceClient } from '../../../rest/clients/ResourceClient';
import { makeSubscription } from '../../mockAzure';
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

        const client = await ResourceClient.create(ctx, executor, subscription, { httpClient });
        const pages = [];
        for await (const page of client.resourceGroups.list()) {
            pages.push(page);
        }

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

        const client = await ResourceClient.create(ctx, executor, subscription, { httpClient });
        const pages = [];
        for await (const page of client.resources.listByResourceGroup('rg1')) {
            pages.push(page);
        }

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
                { id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Web/sites/wf1', name: 'wf1', type: 'Microsoft.Web/sites', kind: 'workflowapp', location: 'eastus' },
                { id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Web/sites/app1', name: 'app1', type: 'Microsoft.Web/sites', kind: 'app', location: 'eastus' },
            ],
        });

        const httpClient = new MockHttpClient({
            handler: (req) => makeResponse(req, 200, resourcesBody),
        });

        const client = await ResourceClient.create(ctx, executor, subscription, { httpClient });
        const pages = [];
        for await (const page of client.resources.listByResourceGroup('rg1')) {
            pages.push(page);
        }

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

        const client = await ResourceClient.create(ctx, executor, subscription, { httpClient });
        const pages = [];
        for await (const page of client.resourceGroups.list()) {
            pages.push(page);
        }

        expect(pages).to.have.length(2);
        expect(pages[0].hasMore).to.be.true;
        expect(pages[1].hasMore).to.be.false;
    });
});
