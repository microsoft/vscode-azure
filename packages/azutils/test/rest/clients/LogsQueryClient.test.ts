/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { AzureChinaCloud, AzurePublicCloud } from '../../../src/auth/Environment';
import { LogsQueryClient } from '../../../src/rest/clients/LogsQueryClient';
import { makeCredential } from '../../mockAzure';
import { makeResponse, MockHttpClient } from '../../mockPipeline';

/** A Log Analytics response body with one table of the given rows. */
function tableBody(rows: unknown[][], columns = ['TimeGenerated', 'Log_s']): string {
    return JSON.stringify({
        tables: [{
            name: 'PrimaryResult',
            columns: columns.map(name => ({ name, type: 'string' })),
            rows,
        }],
    });
}

/** Builds a client over a canned handler, with the contexts the pipeline needs. */
function createClient(httpClient: MockHttpClient, environment = AzurePublicCloud) {
    const { ctx } = createMockCodeContext();
    const { executor } = createTestActionExecutor();
    return LogsQueryClient.create(ctx, executor, makeCredential(), environment, { httpClient });
}

describe('LogsQueryClient (unit)', () => {
    it('should flatten each result row into one line', async () => {
        const httpClient = new MockHttpClient({
            handler: req => makeResponse(req, 200, tableBody([
                ['2026-01-01T00:00:00Z', 'starting up'],
                ['2026-01-01T00:00:01Z', 'listening on 8080'],
            ])),
        });

        const lines = await createClient(httpClient).queryWorkspace('workspace-guid', 'ContainerAppConsoleLogs_CL', 5);

        expect(lines).to.deep.equal([
            '2026-01-01T00:00:00Z starting up',
            '2026-01-01T00:00:01Z listening on 8080',
        ]);
    });

    it('should render non-string cells without leaking [object Object]', async () => {
        const httpClient = new MockHttpClient({
            handler: req => makeResponse(req, 200, tableBody(
                [[42, true, { code: 'OOMKilled' }, null]],
                ['count', 'ok', 'detail', 'missing'],
            )),
        });

        const [line] = await createClient(httpClient).queryWorkspace('workspace-guid', 'query', 5);

        expect(line).to.not.contain('[object Object]');
        expect(line).to.contain('42');
        expect(line).to.contain('true');
        expect(line).to.contain('OOMKilled');
    });

    it('should return an empty result rather than throwing when the query fails', async () => {
        // The caller is enriching an error that already happened, so a failure
        // here must not replace it with a less useful one.
        const httpClient = new MockHttpClient({
            handler: req => makeResponse(req, 403, JSON.stringify({ error: { message: 'Forbidden' } })),
        });

        expect(await createClient(httpClient).queryWorkspace('workspace-guid', 'query', 5)).to.be.empty;
    });

    it('should return an empty result rather than throwing when the body is not a result table', async () => {
        const httpClient = new MockHttpClient({
            handler: req => makeResponse(req, 200, JSON.stringify({ unexpected: true })),
        });

        expect(await createClient(httpClient).queryWorkspace('workspace-guid', 'query', 5)).to.be.empty;
    });

    it('should keep the rows a partly-failed query managed to read', async () => {
        // Partial logs still explain the failure the caller is investigating.
        const httpClient = new MockHttpClient({
            handler: req => makeResponse(req, 200, JSON.stringify({
                tables: [{
                    name: 'PrimaryResult',
                    columns: [{ name: 'Log_s', type: 'string' }],
                    rows: [['partial line']],
                }],
                error: { code: 'PartialError', message: 'Query ran over the limit' },
            })),
        });

        expect(await createClient(httpClient).queryWorkspace('workspace-guid', 'query', 5)).to.deep.equal(['partial line']);
    });

    it('should return an empty result when the query matched nothing', async () => {
        const httpClient = new MockHttpClient({
            handler: req => makeResponse(req, 200, tableBody([])),
        });

        expect(await createClient(httpClient).queryWorkspace('workspace-guid', 'query', 5)).to.be.empty;
    });

    it('should post the query to the versioned workspace path', async () => {
        const httpClient = new MockHttpClient({
            handler: req => makeResponse(req, 200, tableBody([])),
        });

        await createClient(httpClient).queryWorkspace('workspace-guid', 'ContainerAppConsoleLogs_CL', 5);

        const [request] = httpClient.requests;
        expect(request.method).to.equal('POST');
        // Omitting the `/v1` segment reaches an endpoint that does not exist,
        // and the caller swallows the failure, so nothing else would catch it.
        expect(request.url).to.equal('https://api.loganalytics.io/v1/workspaces/workspace-guid/query');
        expect(JSON.parse(request.body as string).query).to.equal('ContainerAppConsoleLogs_CL');
    });

    it('should ask for exactly the requested timespan', async () => {
        const httpClient = new MockHttpClient({
            handler: req => makeResponse(req, 200, tableBody([])),
        });

        await createClient(httpClient).queryWorkspace('workspace-guid', 'query', 5);

        // The API takes one ISO 8601 interval, not a pair of instants.
        const { timespan } = JSON.parse(httpClient.requests[0].body as string) as { timespan: string };
        const [start, end] = timespan.split('/').map(value => new Date(value).getTime());
        expect(end - start).to.equal(5 * 60 * 1000);
    });

    it('should query the cloud\'s own Log Analytics endpoint', async () => {
        const httpClient = new MockHttpClient({
            handler: req => makeResponse(req, 200, tableBody([])),
        });

        await createClient(httpClient, AzureChinaCloud).queryWorkspace('workspace-guid', 'query', 5);

        // A sovereign-cloud workspace is not reachable at the public endpoint.
        expect(httpClient.requests[0].url).to.contain('api.loganalytics.azure.cn');
    });
});
