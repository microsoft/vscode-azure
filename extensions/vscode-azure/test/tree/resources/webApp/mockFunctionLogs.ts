/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ApplicationInsightsResourceType, AzureListingCache, ResourceClient,
    type AzureSubscription, type ILogsQueryClient, type LogsQueryResult,
} from '@microsoft/vscode-azure-azutils';
import {
    createMockAzureListingFetcher, createMockWebAppClient, makeCredential,
    makeGenericResource, makeResponse, MockHttpClient,
} from '@microsoft/vscode-azure-azutils/testing';
import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { mock, type Mock } from 'node:test';
import { WebAppSettingsAdapter } from '../../../../src/settings/adapters/WebAppSettingsAdapter';
import type { FunctionApp } from '../../../../src/tree/resources/webApp/FunctionApp';
import { FunctionAppLogStream } from '../../../../src/tree/resources/webApp/FunctionAppLogStream';
import { makeSettingsResource } from '../../../settings/mockSettings';

/** Instrumentation identifier used only in deterministic Application Insights fixtures. */
export const TestInstrumentationKey = 'a1b2c3d4-abcd-1234-abcd-123456abcdef';
const ConnectionStringSetting = 'APPLICATIONINSIGHTS_CONNECTION_STRING';

/** Builds the normalized query table consumed by the function terminal. */
export function logResult(rows: readonly (readonly unknown[])[] = []): LogsQueryResult {
    return {
        tables: [{
            name: 'PrimaryResult',
            columns: [
                { name: 'Timestamp', type: 'datetime' },
                { name: 'Ingested', type: 'datetime' },
                { name: 'ItemId', type: 'string' },
                { name: 'Message', type: 'string' },
            ],
            rows,
        }],
    };
}

/** Varies resource discovery and terminal opening without replacing the underlying shared clients. */
export interface MockFunctionLogsOptions {
    readonly app?: FunctionApp;
    readonly insightsSubscription?: AzureSubscription;
    readonly connectionString?: string;
    readonly openOnShow?: boolean;
}

/** Real settings, ARM discovery, and listing services with a controllable log-query transport. */
export function createFunctionLogs(options?: MockFunctionLogsOptions) {
    const app = options?.app ?? makeSettingsResource();
    const subscription = options?.insightsSubscription ?? app.subscription;
    const resource = makeGenericResource({
        id: `/subscriptions/${subscription.subscriptionId}/resourceGroups/MyRG/providers/${ApplicationInsightsResourceType}/MyInsights`,
        name: 'MyInsights',
        type: ApplicationInsightsResourceType,
        logicalType: ApplicationInsightsResourceType,
        subscription,
        properties: { InstrumentationKey: TestInstrumentationKey },
    });
    const codeContext = createMockCodeContext({ openTerminalsOnShow: options?.openOnShow });
    const terminalMock = codeContext.mock;
    const { executor } = createTestActionExecutor();
    const web = createMockWebAppClient({
        settings: {
            [ConnectionStringSetting]: options?.connectionString ?? `InstrumentationKey=${TestInstrumentationKey};IngestionEndpoint=https://example.invalid`,
        },
    });
    const http = new MockHttpClient({
        handler: request => {
            if (request.url.includes('/providers/Microsoft.Insights?')) {
                return makeResponse(request, 200, JSON.stringify({
                    namespace: 'Microsoft.Insights',
                    resourceTypes: [{ resourceType: 'components', defaultApiVersion: '2020-02-02' }],
                }));
            }
            if (request.url.includes('/resources?')) {
                return makeResponse(request, 200, JSON.stringify({
                    value: request.url.includes(`/subscriptions/${subscription.subscriptionId}/`) ? [resource] : [],
                }));
            }
            return makeResponse(request, 200, JSON.stringify(resource));
        },
    });
    const resources = mock.fn((target: AzureSubscription) => ResourceClient.create(codeContext.ctx, executor, makeCredential(), target, { httpClient: http }));
    const queries: { readonly [K in keyof ILogsQueryClient]: Mock<ILogsQueryClient[K]> } = {
        queryResource: mock.fn(() => Promise.resolve(logResult())),
        queryWorkspace: mock.fn(() => Promise.resolve(logResult())),
    };
    const logs = mock.fn((_target: unknown) => queries);
    const listings = new AzureListingCache(createMockAzureListingFetcher({
        subscriptions: [app.subscription, subscription],
    }), executor);
    const service = new FunctionAppLogStream(
        codeContext.ctx.code, executor, new WebAppSettingsAdapter(codeContext.ctx.code, () => web),
        resources, logs, listings,
    );
    return { service, app, resource, queries, logs, resources, listings, http, web, codeContext, executor, terminals: terminalMock.terminals };
}
