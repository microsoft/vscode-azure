/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { DeploymentClient } from '../../../rest/clients/DeploymentClient';
import { makeSubscription } from '../../mockAzure';
import { makeResponse, MockHttpClient } from '../../mockPipeline';

describe('DeploymentClient (unit)', () => {
    it('should create a client and fetch a deployment via deployments.getAtScope', async () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const subscription = makeSubscription();

        const deploymentBody = JSON.stringify({
            id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Resources/deployments/myDeploy',
            name: 'myDeploy',
            type: 'Microsoft.Resources/deployments',
            properties: {
                provisioningState: 'Succeeded',
            },
        });

        const httpClient = new MockHttpClient({
            handler: (req) => makeResponse(req, 200, deploymentBody),
        });

        const client = DeploymentClient.create(ctx, executor, subscription, { httpClient });
        const deployment = await client.deployments.getAtScope(
            '/subscriptions/test-sub/resourceGroups/rg1',
            'myDeploy',
        );

        expect(deployment.name).to.equal('myDeploy');
        expect(deployment.type).to.equal('Microsoft.Resources/deployments');
        expect(httpClient.requests.length).to.be.greaterThan(0);
    });

    it('should list deployment operations as pages', async () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const subscription = makeSubscription();

        const operationsBody = JSON.stringify({
            value: [
                { id: 'op1', operationId: 'op1', properties: { provisioningOperation: 'Create', provisioningState: 'Succeeded' } },
                { id: 'op2', operationId: 'op2', properties: { provisioningOperation: 'Create', provisioningState: 'Running' } },
            ],
        });

        const httpClient = new MockHttpClient({
            handler: (req) => makeResponse(req, 200, operationsBody),
        });

        const client = DeploymentClient.create(ctx, executor, subscription, { httpClient });
        const pages: unknown[][] = [];
        for await (const page of client.deploymentOperations.listAtScope(
            '/subscriptions/test-sub/resourceGroups/rg1',
            'myDeploy',
        )) {
            pages.push(page.items);
        }

        expect(pages).to.have.length(1);
        expect(pages[0]).to.have.length(2);
    });
});
