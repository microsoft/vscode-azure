/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { FunctionsHostClient, type FunctionsHostTarget } from '../../../src/rest/clients/FunctionsHostClient';
import { makeResponse, MockHttpClient } from '../../mockPipeline';

function createClient(target: FunctionsHostTarget, handler: ConstructorParameters<typeof MockHttpClient>[0]['handler']) {
    const { ctx } = createMockCodeContext();
    const { executor } = createTestActionExecutor();
    const httpClient = new MockHttpClient({ handler });
    return {
        client: FunctionsHostClient.create(ctx, executor, target, { httpClient, retryOptions: { maxRetries: 0 } }),
        httpClient,
    };
}

describe('FunctionsHostClient (unit)', () => {
    it('should read a local host without remote authentication', async () => {
        const { client, httpClient } = createClient({ port: 7071 }, req => makeResponse(req, 200, JSON.stringify([
            {
                name: 'timer', config: { bindings: [{ type: 'timerTrigger' }] }, isDisabled: false,
                // eslint-disable-next-line @typescript-eslint/naming-convention -- Functions host wire field.
                invoke_url_template: null,
            },
        ])));

        const functions = await client.listFunctions();

        expect(functions[0].name).to.equal('timer');
        expect(httpClient.requests[0].url).to.equal('http://127.0.0.1:7071/admin/functions');
        expect(httpClient.requests[0].headers.get('x-functions-key')).to.be.undefined;
        expect(httpClient.requests[0].allowInsecureConnection).to.be.true;
    });

    it('should acquire a remote master key only on request and keep it out of the URL', async () => {
        const getMasterKey = mock.fn(() => Promise.resolve('secret-host-key'));
        const { client, httpClient } = createClient(
            { endpoint: 'https://app.azurewebsites.net', getMasterKey },
            req => makeResponse(req, 200, JSON.stringify({ state: 'Running', version: '4.0' })),
        );
        expect(getMasterKey.mock.callCount()).to.equal(0);

        const status = await client.getStatus();

        expect(status.state).to.equal('Running');
        expect(getMasterKey.mock.callCount()).to.equal(1);
        expect(httpClient.requests[0].headers.get('x-functions-key')).to.equal('secret-host-key');
        expect(httpClient.requests[0].url).to.equal('https://app.azurewebsites.net/admin/host/status');
    });

    it('should send an encoded function name and preserve JSON invocation input', async () => {
        const { client, httpClient } = createClient({ port: 8080 }, req => makeResponse(req, 202, ''));

        await client.invoke('name/with space', { message: 'hello' });

        expect(httpClient.requests[0].method).to.equal('POST');
        expect(httpClient.requests[0].url).to.equal('http://127.0.0.1:8080/admin/functions/name%2Fwith%20space');
        const body = httpClient.requests[0].body;
        if (typeof body !== 'string') {
            throw new Error('Expected a serialized JSON request body.');
        }
        expect(JSON.parse(body)).to.deep.equal({ input: { message: 'hello' } });
    });

    it('should preserve host error information for readiness checks', async () => {
        const { client } = createClient({ port: 7071 }, req => makeResponse(req, 200, JSON.stringify({
            state: 'Error', errors: ['Worker failed to start.'],
        })));

        expect(await client.getStatus()).to.deep.equal({ state: 'Error', errors: ['Worker failed to start.'] });
    });

    for (const status of [401, 403, 503]) {
        it(`should surface HTTP ${status} without including the service body`, async () => {
            const { client } = createClient({ port: 7071 }, req => makeResponse(req, status, 'sensitive-service-response'));

            await expect(client.getStatus()).to.be.rejectedWith(`HTTP ${status}`);
        });
    }

    it('should reject redirects without forwarding a master key', async () => {
        const { client, httpClient } = createClient(
            { endpoint: 'https://app.azurewebsites.net', getMasterKey: () => Promise.resolve('secret-host-key') },
            req => makeResponse(req, 302, '', { location: 'https://another.example/admin/host/status' }),
        );

        await expect(client.getStatus()).to.be.rejectedWith('HTTP 302');
        expect(httpClient.requests).to.have.length(1);
    });

    it('should reject a missing remote master key before sending a request', async () => {
        const { client, httpClient } = createClient(
            { endpoint: 'https://app.azurewebsites.net', getMasterKey: () => Promise.resolve('') },
            req => makeResponse(req, 200, '{}'),
        );

        await expect(client.getStatus()).to.be.rejectedWith('master key');
        expect(httpClient.requests).to.have.length(0);
    });

    it('should propagate failures retrieving the remote master key', async () => {
        const { client, httpClient } = createClient(
            { endpoint: 'https://app.azurewebsites.net', getMasterKey: () => Promise.reject(new Error('Access denied')) },
            req => makeResponse(req, 200, '{}'),
        );

        await expect(client.listFunctions()).to.be.rejectedWith('Access denied');
        expect(httpClient.requests).to.have.length(0);
    });

    for (const body of [{ error: 'not a collection' }, [{ name: 'fn', isDisabled: 'false' }], [{}]]) {
        it(`should reject malformed function metadata: ${JSON.stringify(body)}`, async () => {
            const { client } = createClient({ port: 7071 }, req => makeResponse(req, 200, JSON.stringify(body)));

            await expect(client.listFunctions()).to.be.rejectedWith('invalid function metadata');
        });
    }

    it('should reject a malformed host status', async () => {
        const { client } = createClient({ port: 7071 }, req => makeResponse(req, 200, '{}'));

        await expect(client.getStatus()).to.be.rejectedWith('invalid status');
    });

    for (const status of [200, 202, 204]) {
        it(`should accept a successful function invocation with HTTP ${status}`, async () => {
            const { client, httpClient } = createClient({ port: 7071 }, req => makeResponse(req, status, ''));

            await client.invoke('fn', 'input');

            expect(httpClient.requests[0].method).to.equal('POST');
            expect(httpClient.requests[0].url).to.equal('http://127.0.0.1:7071/admin/functions/fn');
        });
    }

    it('should pass cancellation and timeouts to the request transport', async () => {
        const controller = new AbortController();
        const { client, httpClient } = createClient({ port: 7071 }, req => makeResponse(req, 200, '{"state":"Running"}'));

        await client.getStatus({ abortSignal: controller.signal, requestOptions: { timeout: 5000 } });

        expect(httpClient.requests[0].abortSignal).to.equal(controller.signal);
        expect(httpClient.requests[0].timeout).to.equal(5000);
    });

    it('should reject invalid local ports and credential-bearing or insecure remote endpoints', () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        for (const port of [0, -1, 65536, 1.5, NaN]) {
            expect(() => FunctionsHostClient.create(ctx, executor, { port })).to.throw('port');
        }
        for (const endpoint of ['not an endpoint', 'http://app.azurewebsites.net', 'https://user:password@app.azurewebsites.net', 'https://app.azurewebsites.net?code=secret', 'https://app.azurewebsites.net/path']) {
            expect(() => FunctionsHostClient.create(ctx, executor, {
                endpoint, getMasterKey: () => Promise.resolve('key'),
            })).to.throw('HTTPS origin');
        }
    });
});
