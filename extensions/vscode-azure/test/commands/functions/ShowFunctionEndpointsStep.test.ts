/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockWebAppClient, makeFunctionEnvelope, makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import { createMockCodeContext, MockOutputChannel, MockUri, pagesOf, rejectingAsyncIterable, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import type * as vscode from 'vscode';
import { ShowFunctionEndpointsStep } from '../../../src/commands/functions/steps/ShowFunctionEndpointsStep';
import { OpenUrl } from '../../../src/commands/OpenUrl';
import { createMockAzdService } from '../../azd/MockAzdService';

describe('ShowFunctionEndpointsStep (unit)', () => {
    afterEach(() => { mock.restoreAll(); });

    function setup(url = 'https://sample.azurewebsites.net/orders/{id}?code=private-key') {
        const { ctx, mock: m } = createMockCodeContext();
        const azd = createMockAzdService();
        const subscription = makeSubscription();
        azd.show.mock.mockImplementation(() => Promise.resolve({
            services: { api: { target: { resourceIds: [`/subscriptions/${subscription.subscriptionId}/resourceGroups/rg/providers/Microsoft.Web/sites/sample`] } } },
        }));
        const client = createMockWebAppClient();
        client.webApps.listFunctions.mock.mockImplementation(() => pagesOf([
                makeFunctionEnvelope({
                    name: 'sample/Orders', invokeUrlTemplate: url,
                    config: { bindings: [{ type: 'httpTrigger', authLevel: 'function' }] },
                }),
                makeFunctionEnvelope({ name: 'sample/Timer', config: { bindings: [{ type: 'timerTrigger' }] } }),
        ]));
        const output = new MockOutputChannel('test');
        const resolveSubscription = mock.fn((_id: string) => Promise.resolve(subscription));
        const step = new ShowFunctionEndpointsStep(ctx, azd, () => client, resolveSubscription, output, new OpenUrl(ctx.code));
        const context = { job: 'deploy' as const, deploy: true, iacFolder: MockUri.file('/workspace'), azdServiceName: 'api', resourceDisplayName: 'Function App' };
        return { step, context, client, ctx, m, subscription, resolveSubscription, azd, output };
    }

    it('uses actual HTTP templates and excludes authentication keys', async () => {
        const { step, context, client, ctx, m } = setup();
        const responses = respondToPrompts(m, [{ button: 'View HTTP URLs' }, { pick: 'Orders' }]);
        const opened = new Promise<void>(resolve => {
            mock.method(ctx.code.env, 'openExternal', (uri: vscode.Uri) => {
                expect(uri.toString()).to.equal('https://sample.azurewebsites.net/orders/%7Bid%7D');
                resolve();
                return Promise.resolve(true);
            });
        });
        await step.execute(context);
        await opened;
        responses.assertAllConsumed();
        expect(client.webApps.listFunctionKeys.mock.callCount()).to.equal(0);
        expect(client.webApps.listHostKeys.mock.callCount()).to.equal(0);
    });

    it('reports an unavailable endpoint without inventing a route', async () => {
        const { step, context, m } = setup('http://sample.azurewebsites.net/api/Orders');
        await step.execute(context);
        expect(m.window.showWarningMessage.mock.callCount()).to.equal(1);
    });

    it('preserves the selected app subscription instead of resolving another account identity', async () => {
        const { step, context, subscription, resolveSubscription } = setup();
        await step.execute({ ...context, subscription });
        expect(resolveSubscription.mock.callCount()).to.equal(0);
    });

    for (const scoped of [true, false]) {
        it(`lists HTTP endpoints for ${scoped ? 'only the selected service' : 'all services in an unscoped deployment'}`, async () => {
            const s = setup();
            const prefix = `/subscriptions/${s.subscription.subscriptionId}/resourceGroups/rg/providers/`;
            s.azd.show.mock.mockImplementation(() => Promise.resolve({
                services: {
                    api: { target: { resourceIds: [`${prefix}Microsoft.Web/sites/api`, `${prefix}Microsoft.Storage/storageAccounts/storage`] } },
                    other: { target: { resourceIds: [`${prefix}Microsoft.Web/sites/other`] } },
                },
            }));
            await s.step.execute({ ...s.context, azdServiceName: scoped ? 'api' : undefined });
            expect(s.client.webApps.listFunctions.mock.calls.map(call => call.arguments)).to.deep.equal(
                scoped ? [['rg', 'api']] : [['rg', 'api'], ['rg', 'other']],
            );
        });
    }

    it('reports a successful deployment with no HTTP functions without offering an endpoint', async () => {
        const s = setup();
        s.client.webApps.listFunctions.mock.mockImplementation(() => pagesOf([
            makeFunctionEnvelope({ config: { bindings: [{ type: 'timerTrigger' }] } }),
        ]));
        await s.step.execute(s.context);
        expect(s.m.window.showInformationMessage.mock.calls[0].arguments[0]).to.equal(
            'Deployment completed. No HTTP invocation URLs are currently reported by Azure.',
        );
        expect(s.m.window.showWarningMessage.mock.callCount()).to.equal(0);
        expect(s.m.quickPicks).to.be.empty;
        expect(s.m.env.openExternal.mock.callCount()).to.equal(0);
    });

    for (const failure of ['discovery', 'function listing'] as const) {
        it(`warns without undoing a completed deployment when ${failure} fails`, async () => {
            const s = setup();
            const warning = mock.method(s.output, 'warn');
            const error = new Error('Azure access denied: private response.');
            if (failure === 'discovery') {
                s.azd.show.mock.mockImplementation(() => Promise.reject(error));
            } else {
                s.client.webApps.listFunctions.mock.mockImplementation(() => rejectingAsyncIterable(error));
            }
            await s.step.execute(s.context);
            expect(s.m.window.showWarningMessage.mock.calls[0].arguments[0]).to.equal(
                'Deployment completed, but HTTP invocation URLs could not be retrieved. Refresh the Function App and use Copy Function URL.',
            );
            expect(warning.mock.calls[0].arguments[0]).to.equal(
                '[functions] Deployment completed, but HTTP invocation URLs could not be retrieved.',
            );
            expect(s.m.quickPicks).to.be.empty;
            expect(s.m.env.openExternal.mock.callCount()).to.equal(0);
            expect(s.client.webApps.listFunctions.mock.callCount()).to.equal(failure === 'discovery' ? 0 : 1);
        });
    }
});
