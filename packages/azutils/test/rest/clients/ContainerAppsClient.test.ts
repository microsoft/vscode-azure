/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { ContainerAppsClient } from '../../../src/rest/clients/ContainerAppsClient';
import { makeCredential, makeSubscription } from '../../mockAzure';
import { makeResponse, MockHttpClient } from '../../mockPipeline';

const appId = '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.App/containerApps/myApp';

function createClient(handler: ConstructorParameters<typeof MockHttpClient>[0]['handler']) {
    const { ctx } = createMockCodeContext();
    const { executor } = createTestActionExecutor();
    const httpClient = new MockHttpClient({ handler });
    const client = ContainerAppsClient.create(ctx, executor, makeCredential(), makeSubscription(), { httpClient });
    return { client, httpClient };
}

describe('ContainerAppsClient (unit)', () => {
    it('should fetch a container app with its properties flattened onto the resource', async () => {
        const body = JSON.stringify({
            id: appId,
            name: 'myApp',
            type: 'Microsoft.App/containerApps',
            location: 'eastus',
            properties: {
                environmentId: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.App/managedEnvironments/myEnv',
                latestRevisionName: 'myapp--abc123',
                configuration: { ingress: { fqdn: 'myapp.eastus.azurecontainerapps.io' } },
                template: { containers: [{ name: 'api', image: 'myacr.azurecr.io/api:v1' }] },
            },
        });
        const { client, httpClient } = createClient(req => makeResponse(req, 200, body));

        const app = await client.containerApps.get('rg1', 'myApp');

        // The modular SDK lifts ARM's `properties` bag onto the resource; the
        // tree reads these as top-level fields.
        expect(app.name).to.equal('myApp');
        expect(app.environmentId).to.contain('myEnv');
        expect(app.latestRevisionName).to.equal('myapp--abc123');
        expect(app.template?.containers?.[0].image).to.equal('myacr.azurecr.io/api:v1');
        expect(httpClient.requests[0].url).to.include('myApp');
    });

    it('should exchange ARM credentials for a data-plane token', async () => {
        const body = JSON.stringify({
            id: `${appId}/authtoken`,
            name: 'myApp',
            type: 'Microsoft.App/containerApps',
            location: 'eastus',
            properties: { token: 'data-plane-token' },
        });
        const { client, httpClient } = createClient(req => makeResponse(req, 200, body));

        const authToken = await client.containerApps.getAuthToken('rg1', 'myApp');

        expect(authToken.token).to.equal('data-plane-token');
        expect(httpClient.requests[0].url).to.include('getAuthtoken');
    });

    it('should restart a revision', async () => {
        const { client, httpClient } = createClient(req => makeResponse(req, 200, ''));

        await client.containerAppsRevisions.restartRevision('rg1', 'myApp', 'myapp--abc123');

        expect(httpClient.requests[0].method).to.equal('POST');
        expect(httpClient.requests[0].url).to.include('revisions/myapp--abc123/restart');
    });

    it('should return the replica collection as a plain array', async () => {
        const body = JSON.stringify({
            value: [{
                id: `${appId}/revisions/rev1/replicas/replica1`,
                name: 'replica1',
                type: 'Microsoft.App/containerApps/revisions/replicas',
                properties: { containers: [{ name: 'api', logStreamEndpoint: 'https://x.azurecontainerapps.io/logstream' }] },
            }],
        });
        const { client } = createClient(req => makeResponse(req, 200, body));

        const replicas = await client.containerAppsRevisionReplicas.listReplicas('rg1', 'myApp', 'rev1');

        // The service returns the whole collection in one response, so the
        // wrapper unwraps it rather than exposing a pager that never pages.
        expect(replicas).to.have.length(1);
        expect(replicas[0].containers?.[0].logStreamEndpoint).to.contain('azurecontainerapps.io');
    });

    it('should fetch a managed environment with its log analytics configuration', async () => {
        const body = JSON.stringify({
            id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.App/managedEnvironments/myEnv',
            name: 'myEnv',
            type: 'Microsoft.App/managedEnvironments',
            location: 'eastus',
            properties: {
                appLogsConfiguration: {
                    destination: 'log-analytics',
                    logAnalyticsConfiguration: { customerId: 'workspace-guid' },
                },
            },
        });
        const { client } = createClient(req => makeResponse(req, 200, body));

        const environment = await client.managedEnvironments.get('rg1', 'myEnv');

        expect(environment.appLogsConfiguration?.logAnalyticsConfiguration?.customerId).to.equal('workspace-guid');
    });
});
