/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { WebAppClient } from '../../../src/rest/clients/WebAppClient';
import { makeCredential, makeSubscription } from '../../mockAzure';
import { makeResponse, MockHttpClient } from '../../mockPipeline';

describe('WebAppClient (unit)', () => {
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

    it('should get a static web app', async () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const subscription = makeSubscription();
        const httpClient = new MockHttpClient({
            handler: (req) => makeResponse(req, 200, JSON.stringify({
                name: 'myswa',
                properties: {
                    defaultHostname: 'example.azurestaticapps.net',
                },
            })),
        });

        const client = WebAppClient.create(ctx, executor, makeCredential(), subscription, { httpClient });
        const result = await client.staticSites.getStaticSite('rg1', 'myswa');

        expect(result.defaultHostname).to.equal('example.azurestaticapps.net');
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
