/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { collectPages } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { WebAppClient } from '../../../src/rest/clients/WebAppClient';
import { makeCredential, makeSubscription } from '../../mockAzure';
import { makeResponse, MockHttpClient } from '../../mockPipeline';

describe('WebAppClient (unit)', () => {
    for (const operation of ['start', 'stop', 'restart'] as const) {
        it(`should ${operation} the selected web app`, async () => {
            const { ctx } = createMockCodeContext();
            const { executor } = createTestActionExecutor();
            const httpClient = new MockHttpClient({
                handler: req => makeResponse(req, 200, ''),
            });
            const client = WebAppClient.create(ctx, executor, makeCredential(), makeSubscription(), { httpClient });

            await client.webApps[operation]('rg1', 'myapp');

            const request = httpClient.requests[0];
            expect(request.method).to.equal('POST');
            expect(new URL(request.url).pathname).to.equal(`/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Web/sites/myapp/${operation}`);
        });
    }

    it('should list every page of functions and deserialize their metadata', async () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const nextLink = 'https://management.azure.com/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Web/sites/myapp/functions?api-version=2025-05-01&next=2';
        const httpClient = new MockHttpClient({
            handler: req => makeResponse(req, 200, JSON.stringify(req.url === nextLink
                ? { value: [{ name: 'myapp/timer', properties: { isDisabled: true } }] }
                : {
                    value: [{
                        name: 'myapp/http',
                        properties: {
                            config: { bindings: [{ type: 'httpTrigger', authLevel: 'function' }] },
                            // eslint-disable-next-line @typescript-eslint/naming-convention -- ARM wire field.
                            invoke_url_template: 'https://myapp.azurewebsites.net/api/http',
                        },
                    }],
                    nextLink,
                })),
        });
        const client = WebAppClient.create(ctx, executor, makeCredential(), makeSubscription(), { httpClient });

        const pages = await collectPages(client.webApps.listFunctions('rg1', 'myapp'));

        expect(pages).to.have.length(2);
        expect(pages.map(page => page.hasMore)).to.deep.equal([true, false]);
        expect(pages[0].items[0].config?.bindings).to.deep.equal([{ type: 'httpTrigger', authLevel: 'function' }]);
        expect(pages[0].items[0].invokeUrlTemplate).to.equal('https://myapp.azurewebsites.net/api/http');
        expect(pages[1].items[0].isDisabled).to.be.true;
        expect(httpClient.requests).to.have.length(2);
    });

    it('should read a named function rather than its parent app', async () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const httpClient = new MockHttpClient({
            handler: req => makeResponse(req, 200, JSON.stringify({
                name: 'myapp/hello',
                properties: { language: 'python', isDisabled: false },
            })),
        });
        const client = WebAppClient.create(ctx, executor, makeCredential(), makeSubscription(), { httpClient });

        const result = await client.webApps.getFunction('rg1', 'myapp', 'hello');

        expect(result.language).to.equal('python');
        expect(new URL(httpClient.requests[0].url).pathname).to.match(/\/sites\/myapp\/functions\/hello$/);
    });

    it('should read function keys, host keys, and invocation secrets from their distinct endpoints', async () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const httpClient = new MockHttpClient({
            handler: req => {
                const path = new URL(req.url).pathname;
                expect(req.method).to.equal('POST');
                if (path.endsWith('/host/default/listkeys')) {
                    return makeResponse(req, 200, JSON.stringify({ masterKey: 'host-key', functionKeys: { default: 'shared-key' } }));
                }
                if (path.endsWith('/functions/hello/listkeys')) {
                    return makeResponse(req, 200, JSON.stringify({ properties: { default: 'function-key' } }));
                }
                expect(path).to.match(/\/functions\/hello\/listsecrets$/);
                return makeResponse(req, 200, JSON.stringify({
                    key: 'function-key',
                    // eslint-disable-next-line @typescript-eslint/naming-convention -- ARM wire field.
                    trigger_url: 'https://myapp.azurewebsites.net/api/hello',
                }));
            },
        });
        const client = WebAppClient.create(ctx, executor, makeCredential(), makeSubscription(), { httpClient });

        expect((await client.webApps.listHostKeys('rg1', 'myapp')).masterKey).to.equal('host-key');
        expect((await client.webApps.listFunctionKeys('rg1', 'myapp', 'hello')).properties?.default).to.equal('function-key');
        expect((await client.webApps.listFunctionSecrets('rg1', 'myapp', 'hello')).triggerUrl).to.equal('https://myapp.azurewebsites.net/api/hello');
    });

    it('should surface management-plane authorization failures', async () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const httpClient = new MockHttpClient({
            handler: req => makeResponse(req, 403, JSON.stringify({ error: { code: 'AuthorizationFailed', message: 'Forbidden' } })),
        });
        const client = WebAppClient.create(ctx, executor, makeCredential(), makeSubscription(), { httpClient });

        await expect(client.webApps.listHostKeys('rg1', 'myapp')).to.be.rejectedWith('Forbidden');
    });

    it('should get a web app', async () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const subscription = makeSubscription();
        const httpClient = new MockHttpClient({
            handler: (req) => makeResponse(req, 200, JSON.stringify({
                name: 'myapp',
                properties: {
                    defaultHostName: 'myapp.azurewebsites.net',
                },
            })),
        });

        const client = WebAppClient.create(ctx, executor, makeCredential(), subscription, { httpClient });
        const result = await client.webApps.get('rg1', 'myapp');

        expect(result.defaultHostName).to.equal('myapp.azurewebsites.net');
    });

    it('should list application settings', async () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const subscription = makeSubscription();

        const settingsBody = JSON.stringify({
            properties: {
                nodeVersion: '~18',
                greeting: 'hello',
            },
        });

        const httpClient = new MockHttpClient({
            handler: (req) => makeResponse(req, 200, settingsBody),
        });

        const client = WebAppClient.create(ctx, executor, makeCredential(), subscription, { httpClient });
        const result = await client.webApps.listApplicationSettings('rg1', 'myapp');

        expect(result.properties).to.deep.equal({
            nodeVersion: '~18',
            greeting: 'hello',
        });
    });

    it('should update application settings', async () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const subscription = makeSubscription();

        const updatedBody = JSON.stringify({
            properties: {
                greeting: 'updated',
            },
        });

        const httpClient = new MockHttpClient({
            handler: (req) => {
                expect(req.method).to.equal('PUT');
                return makeResponse(req, 200, updatedBody);
            },
        });

        const client = WebAppClient.create(ctx, executor, makeCredential(), subscription, { httpClient });
        const result = await client.webApps.updateApplicationSettings('rg1', 'myapp', {
            properties: { greeting: 'updated' },
        });

        expect(result.properties).to.deep.equal({
            greeting: 'updated',
        });
    });
});
