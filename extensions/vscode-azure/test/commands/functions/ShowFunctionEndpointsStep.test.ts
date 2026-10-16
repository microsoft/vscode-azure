/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockWebAppClient, makeFunctionEnvelope, makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import { ExternalError } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, MockOutputChannel, MockUri, pagesOf, rejectingAsyncIterable, respondToPrompts, waitFor } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { ShowFunctionEndpointsStep } from '../../../src/commands/functions/steps/ShowFunctionEndpointsStep';
import { OpenUrl } from '../../../src/commands/OpenUrl';
import type { ISubscriptionResolver } from '../../../src/services';
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
        const resolveSubscription = mock.fn<ISubscriptionResolver>((_id: string) => Promise.resolve(subscription));
        const step = new ShowFunctionEndpointsStep(ctx, azd, () => client, resolveSubscription, output, new OpenUrl(ctx.code));
        const context = { job: 'deploy' as const, deploy: true, iacFolder: MockUri.file('/workspace'), azdServiceName: 'api', resourceDisplayName: 'Function App' };
        return { step, context, client, ctx, m, subscription, resolveSubscription, azd, output };
    }

    it('uses actual HTTP templates and excludes authentication keys', async () => {
        const { step, context, client, m } = setup();
        const responses = respondToPrompts(m, [{ button: 'View HTTP URLs' }, { pick: 'Orders' }]);
        await step.execute(context);
        await waitFor(() => m.env.openExternal.mock.callCount() === 1, 'the selected HTTP endpoint to open');
        expect(m.env.openExternal.mock.calls[0].arguments[0].toString()).to.equal('https://sample.azurewebsites.net/orders/%7Bid%7D');
        responses.assertAllConsumed();
        expect(client.webApps.listFunctionKeys.mock.callCount()).to.equal(0);
        expect(client.webApps.listHostKeys.mock.callCount()).to.equal(0);
    });

    for (const { url, reason } of [
        { url: 'invalid-url', reason: 'Azure did not report a valid HTTP invocation template.' },
        {
            url: 'http://sample.azurewebsites.net/api/Orders',
            reason: 'A remote function invocation template must use HTTPS without embedded credentials.',
        },
        {
            url: 'https://username:private-key@sample.azurewebsites.net/api/Orders',
            reason: 'A remote function invocation template must use HTTPS without embedded credentials.',
        },
    ]) {
        it(`reports the safe validation reason for an unavailable endpoint: ${url.split(':')[0]}`, async () => {
            const { step, context, m, output } = setup(url);
            const warning = mock.method(output, 'warn');
            await step.execute(context);
            const message = `Deployment completed, but HTTP invocation URLs could not be retrieved. ${reason}`;
            expect(m.window.showWarningMessage.mock.calls[0].arguments[0]).to.equal(message);
            expect(warning.mock.calls[0].arguments[0]).to.equal(
                `[functions] HTTP invocation URL retrieval failed during function listing: ${message}`,
            );
            expect(m.env.openExternal.mock.callCount()).to.equal(0);
        });
    }

    it('explains how to recover when the deployed subscription is not signed in', async () => {
        const { step, context, m, output, resolveSubscription } = setup();
        const warning = mock.method(output, 'warn');
        resolveSubscription.mock.mockImplementation(() => Promise.resolve(undefined));
        await step.execute(context);
        const message = 'Deployment completed, but HTTP invocation URLs could not be retrieved. Sign in to the deployed Function App subscription to list its HTTP URLs.';
        expect(m.window.showWarningMessage.mock.calls[0].arguments[0]).to.equal(message);
        expect(warning.mock.calls[0].arguments[0]).to.equal(
            `[functions] HTTP invocation URL retrieval failed during subscription resolution: ${message}`,
        );
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

    for (const failure of ['deployment discovery', 'subscription resolution', 'function listing'] as const) {
        for (const ErrorType of [Error, ExternalError]) {
            it(`reports a safe diagnostic when ${failure} fails with an upstream ${ErrorType.name}`, async () => {
                const s = setup();
                const warning = mock.method(s.output, 'warn');
                const error = new ErrorType('Azure access denied: private response.');
                if (failure === 'deployment discovery') {
                    s.azd.show.mock.mockImplementation(() => Promise.reject(error));
                } else if (failure === 'subscription resolution') {
                    s.resolveSubscription.mock.mockImplementation(() => Promise.reject(error));
                } else {
                    s.client.webApps.listFunctions.mock.mockImplementation(() => rejectingAsyncIterable(error));
                }
                await s.step.execute(s.context);
                const message = 'Deployment completed, but HTTP invocation URLs could not be retrieved. Refresh the Function App and use Copy Function URL.';
                expect(s.m.window.showWarningMessage.mock.calls[0].arguments[0]).to.equal(message);
                expect(warning.mock.calls[0].arguments[0]).to.equal(
                    `[functions] HTTP invocation URL retrieval failed during ${failure}: ${message}`,
                );
                expect(s.m.quickPicks).to.be.empty;
                expect(s.m.env.openExternal.mock.callCount()).to.equal(0);
                expect(s.client.webApps.listFunctions.mock.callCount()).to.equal(failure === 'function listing' ? 1 : 0);
            });
        }
    }
});
