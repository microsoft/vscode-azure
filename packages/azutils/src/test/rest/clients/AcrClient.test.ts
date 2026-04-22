/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { AcrClient } from '../../../rest/clients/AcrClient';
import { makeSubscription } from '../../mockAzure';
import { makeResponse, MockHttpClient } from '../../mockPipeline';

describe('AcrClient (unit)', () => {
    it('should create a client and fetch a registry via registries.get', async () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const subscription = makeSubscription();

        const registryBody = JSON.stringify({
            id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.ContainerRegistry/registries/myReg',
            name: 'myReg',
            type: 'Microsoft.ContainerRegistry/registries',
            location: 'eastus',
            sku: { name: 'Basic', tier: 'Basic' },
        });

        const httpClient = new MockHttpClient({
            handler: (req) => makeResponse(req, 200, registryBody),
        });

        const client = await AcrClient.create(ctx, executor, subscription, { httpClient });
        const registry = await client.registries.get('rg1', 'myReg');

        expect(registry.name).to.equal('myReg');
        expect(registry.type).to.equal('Microsoft.ContainerRegistry/registries');
        expect(registry.location).to.equal('eastus');
        expect(httpClient.requests.length).to.be.greaterThan(0);
        expect(httpClient.requests[0].url).to.include('myReg');
    });
});
