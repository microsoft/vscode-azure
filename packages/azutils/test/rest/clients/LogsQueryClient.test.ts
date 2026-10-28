/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { AzurePublicCloud, AzureUSGovernment, type EnvironmentLike } from '../../../src/auth/Environment';
import { LogsQueryClient } from '../../../src/rest/clients/LogsQueryClient';
import { makeCredential, makeSubscription } from '../../mockAzure';
import { makeResponse, MockHttpClient } from '../../mockPipeline';

const workspaceId = '11111111-2222-3333-4444-555555555555';
const resourceId = '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Insights/components/myapp';

function createClient(handler: ConstructorParameters<typeof MockHttpClient>[0]['handler'], environment: EnvironmentLike = AzurePublicCloud) {
    const { ctx } = createMockCodeContext();
    const { executor } = createTestActionExecutor();
    const credential = makeCredential();
    const httpClient = new MockHttpClient({ handler });
    return {
        client: LogsQueryClient.create(ctx, executor, credential, makeSubscription({ environment }), {
            httpClient, retryOptions: { maxRetries: 0 },
        }),
        httpClient,
        credential,
    };
}

describe('LogsQueryClient (unit)', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    it('should post resource-scoped queries and retain the complete table schema', async () => {
        const body = {
            tables: [{
                name: 'PrimaryResult',
                columns: [{ name: 'TimeGenerated', type: 'datetime' }, { name: 'Message', type: 'string' }],
                rows: [['2026-10-08T16:00:00Z', 'Hello'], ['2026-10-08T16:00:01Z', null]],
            }],
        };
        const { client, httpClient } = createClient(req => makeResponse(req, 200, JSON.stringify(body)));

        const result = await client.queryResource(resourceId, 'AppTraces | take 2', { timespan: 'PT5M' });

        expect(result).to.deep.equal(body);
        expect(httpClient.requests[0].method).to.equal('POST');
        expect(httpClient.requests[0].url).to.equal(`https://api.loganalytics.io/v1${resourceId}/query`);
        const requestBody = httpClient.requests[0].body;
        if (typeof requestBody !== 'string') {
            throw new Error('Expected a serialized JSON request body.');
        }
        expect(JSON.parse(requestBody)).to.deep.equal({ query: 'AppTraces | take 2', timespan: 'PT5M' });
    });

    it('should use the configured sovereign endpoint and token audience', async () => {
        const { client, httpClient, credential } = createClient(req => makeResponse(req, 200, '{"tables":[]}'), AzureUSGovernment);
        const tokenSpy = mock.method(credential, 'getToken');
        expect(tokenSpy.mock.callCount()).to.equal(0);

        await client.queryWorkspace(workspaceId, 'AppTraces | take 1');

        expect(httpClient.requests[0].url).to.equal(`https://api.loganalytics.us/v1/workspaces/${workspaceId}/query`);
        expect(httpClient.requests[0].headers.get('authorization')).to.equal('Bearer mock-token');
        expect(tokenSpy.mock.calls[0].arguments[0]).to.deep.equal(['https://api.loganalytics.us/.default']);
    });

    it('should escape resource names without changing the resource ID structure', async () => {
        const { client, httpClient } = createClient(req => makeResponse(req, 200, '{"tables":[]}'));

        await client.queryResource(resourceId.replace('myapp', 'my app'), 'AppTraces');

        expect(httpClient.requests[0].url).to.equal(`https://api.loganalytics.io/v1${resourceId.replace('myapp', 'my%20app')}/query`);
    });

    it('should query GUID workspace IDs without requiring UUID version or variant bits', async () => {
        const { client, httpClient } = createClient(req => makeResponse(req, 200, '{"tables":[]}'));
        const ids = [
            'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
        ];

        for (const id of ids) {
            await client.queryWorkspace(id, 'AppTraces');
        }

        expect(httpClient.requests.map(request => request.url)).to.deep.equal(
            ids.map(id => `https://api.loganalytics.io/v1/workspaces/${id}/query`),
        );
    });

    it('should query subscription-scoped and nested resources with case-insensitive ARM segments', async () => {
        const { client, httpClient } = createClient(req => makeResponse(req, 200, '{"tables":[]}'));
        const ids = [
            '/SUBSCRIPTIONS/test-sub/PROVIDERS/Microsoft.Insights/components/myapp',
            `${resourceId}/childType/childName`,
        ];

        for (const id of ids) {
            await client.queryResource(id, 'AppTraces');
        }

        expect(httpClient.requests.map(request => request.url)).to.deep.equal(
            ids.map(id => `https://api.loganalytics.io/v1${id}/query`),
        );
    });

    it('should surface partial query failures instead of returning successful-looking tables', async () => {
        const { client } = createClient(req => makeResponse(req, 200, JSON.stringify({
            tables: [], error: { code: 'PartialError', message: 'One data source failed.' },
        })));

        await expect(client.queryWorkspace(workspaceId, 'AppTraces')).to.be.rejectedWith('incomplete results');
    });

    it('should report only the codes of a rejected query, never its message', async () => {
        const { client } = createClient(req => makeResponse(req, 400, JSON.stringify({
            error: {
                code: 'BadArgumentError',
                message: 'sensitive-response-content',
                innererror: { code: 'SemanticError', message: 'more sensitive text', innererror: { code: 'SEM0100', message: 'quoted query text' } },
            },
        })));

        const error = await client.queryResource(resourceId, 'AppTraces').catch((e: unknown) => e);

        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.equal('The service request failed (HTTP 400: BadArgumentError, SemanticError, SEM0100).');
        expect(error).to.have.property('statusCode', 400);
    });

    it('should report a rejected query without codes when the body has none', async () => {
        const { client } = createClient(req => makeResponse(req, 400, 'not json'));

        await expect(client.queryResource(resourceId, 'AppTraces')).to.be.rejectedWith('The service request failed (HTTP 400).');
    });

    for (const status of [200, 201, 202, 206, 299]) {
        it(`should return valid log query results for HTTP ${status}`, async () => {
            const { client } = createClient(req => makeResponse(req, status, '{"tables":[]}'));

            expect(await client.queryResource(resourceId, 'AppTraces')).to.deep.equal({ tables: [] });
        });
    }

    it('should require query results when a successful response has no body', async () => {
        const { client } = createClient(req => makeResponse(req, 204, ''));

        await expect(client.queryResource(resourceId, 'AppTraces')).to.be.rejectedWith('invalid log query result');
    });

    for (const status of [199, 300, 304, 401, 403, 429, 500]) {
        it(`should propagate HTTP ${status} errors`, async () => {
            const { client } = createClient(req => makeResponse(req, status, JSON.stringify({
                error: { code: 'QueryFailed', message: 'sensitive-response-content' },
            })));

            await expect(client.queryResource(resourceId, 'AppTraces')).to.be.rejectedWith(`HTTP ${status}`);
        });
    }

    for (const body of [{}, { tables: 'invalid' }, { tables: [{ name: 'PrimaryResult', columns: [{ name: 'Message', type: 'string' }], rows: [[]] }] }]) {
        it(`should reject malformed query results: ${JSON.stringify(body)}`, async () => {
            const { client } = createClient(req => makeResponse(req, 200, JSON.stringify(body)));

            await expect(client.queryWorkspace(workspaceId, 'AppTraces')).to.be.rejectedWith('invalid log query result');
        });
    }

    it('should pass cancellation and timeouts to the request transport', async () => {
        const controller = new AbortController();
        const { client, httpClient } = createClient(req => makeResponse(req, 200, '{"tables":[]}'));

        await client.queryResource(resourceId, 'AppTraces', {
            abortSignal: controller.signal, requestOptions: { timeout: 5000 },
        });

        expect(httpClient.requests[0].abortSignal).to.equal(controller.signal);
        expect(httpClient.requests[0].timeout).to.equal(5000);
    });

    it('should reject invalid query targets before contacting the service', async () => {
        const { client, httpClient } = createClient(req => makeResponse(req, 200, '{"tables":[]}'));

        expect(() => client.queryWorkspace('not-a-guid', 'AppTraces')).to.throw('workspace GUID');
        for (const id of [
            'https://another.example',
            `${resourceId}?secret=value`,
            `${resourceId}#fragment`,
            '/subscriptions/sub',
            '/subscriptions/sub/resourceGroups/rg',
            '/subscriptions/sub/providers/Microsoft.Insights/components',
            `${resourceId}/child`,
            `${resourceId}/child/..`,
        ]) {
            expect(() => client.queryResource(id, 'AppTraces')).to.throw('resource ID');
        }
        await expect(client.queryResource(resourceId, '   ')).to.be.rejectedWith('query is required');
        expect(httpClient.requests).to.have.length(0);
    });
});
