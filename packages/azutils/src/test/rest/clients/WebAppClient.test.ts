/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { WebAppClient } from '../../../rest/clients/WebAppClient';
import { makeSubscription } from '../../mockAzure';
import { makeResponse, MockHttpClient } from '../../mockPipeline';

describe('WebAppClient (unit)', () => {
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

        const client = WebAppClient.create(ctx, executor, subscription, { httpClient });
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

        const client = WebAppClient.create(ctx, executor, subscription, { httpClient });
        const result = await client.webApps.updateApplicationSettings('rg1', 'myapp', {
            properties: { greeting: 'updated' },
        });

        expect(result.properties).to.deep.equal({
            greeting: 'updated',
        });
    });
});
