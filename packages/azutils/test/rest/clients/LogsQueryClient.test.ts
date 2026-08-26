/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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

describe('LogsQueryClient (unit)', () => {
    it('should flatten each result row into one line', async () => {
        const httpClient = new MockHttpClient({
            handler: req => makeResponse(req, 200, tableBody([
                ['2026-01-01T00:00:00Z', 'starting up'],
                ['2026-01-01T00:00:01Z', 'listening on 8080'],
            ])),
        });

        const client = LogsQueryClient.create(makeCredential(), AzurePublicCloud, { httpClient });
        const lines = await client.queryWorkspace('workspace-guid', 'ContainerAppConsoleLogs_CL', 5);

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

        const client = LogsQueryClient.create(makeCredential(), AzurePublicCloud, { httpClient });
        const [line] = await client.queryWorkspace('workspace-guid', 'query', 5);

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

        const client = LogsQueryClient.create(makeCredential(), AzurePublicCloud, { httpClient });

        expect(await client.queryWorkspace('workspace-guid', 'query', 5)).to.be.empty;
    });

    it('should return an empty result when the query matched nothing', async () => {
        const httpClient = new MockHttpClient({
            handler: req => makeResponse(req, 200, tableBody([])),
        });

        const client = LogsQueryClient.create(makeCredential(), AzurePublicCloud, { httpClient });

        expect(await client.queryWorkspace('workspace-guid', 'query', 5)).to.be.empty;
    });

    it('should query the cloud\'s own Log Analytics endpoint', async () => {
        const httpClient = new MockHttpClient({
            handler: req => makeResponse(req, 200, tableBody([])),
        });

        const client = LogsQueryClient.create(makeCredential(), AzureChinaCloud, { httpClient });
        await client.queryWorkspace('workspace-guid', 'query', 5);

        // A sovereign-cloud workspace is not reachable at the public endpoint.
        expect(httpClient.requests[0].url).to.contain('api.loganalytics.azure.cn');
    });
});
