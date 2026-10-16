/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type LogsQueryResult } from '@microsoft/vscode-azure-azutils';
import { makeResponse, makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import { CancellationError } from '@microsoft/vscode-azure-utils';
import { ManualTimers, waitFor } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import type { FunctionAppLogStream } from '../../../../src/tree/resources/webApp/FunctionAppLogStream';
import { createFunctionLogs, logResult, TestInstrumentationKey, type MockFunctionLogsOptions } from './mockFunctionLogs';

describe('FunctionAppLogStream (unit)', () => {
    const timers = new ManualTimers();
    const now = Date.parse('2026-10-15T12:00:00.000Z');
    let services: FunctionAppLogStream[] = [];

    function setup(options?: MockFunctionLogsOptions) {
        const result = createFunctionLogs(options);
        services.push(result.service);
        return result;
    }

    beforeEach(() => {
        timers.enable();
    });

    afterEach(() => {
        for (const service of services) {
            service.dispose();
        }
        services = [];
        timers.reset();
        mock.restoreAll();
    });

    it('discovers live component properties and buffers records until VS Code opens the terminal', async () => {
        const s = setup({ openOnShow: false });
        const timestamp = new Date(now).toISOString();
        s.queries.queryResource.mock.mockImplementation(() => Promise.resolve(logResult([[timestamp, timestamp, 'first', 'first\nsecond']])));
        await s.service.start(s.app);
        expect(s.terminals).to.have.lengthOf(1);
        expect(s.terminals[0].writes).to.be.empty;
        s.terminals[0].pty.open(undefined);
        expect(s.terminals[0].writes.join('')).to.include('ingestion delay.\r\n');
        expect(s.terminals[0].writes.join('')).to.include('first\r\nsecond\r\n');
        expect(s.http.requests.some(request => request.url.includes('/components/MyInsights?'))).to.be.true;
        expect(s.queries.queryResource.mock.calls[0].arguments[0]).to.equal(s.resource.id);
        expect(s.terminals[0].name).to.equal(`Logs: ${s.app.name}`);
    });

    it('deduplicates concurrent initialization and focuses an existing app stream case-insensitively', async () => {
        const s = setup();
        const initial = Promise.withResolvers<LogsQueryResult>();
        s.queries.queryResource.mock.mockImplementation(() => initial.promise);
        const first = s.service.start(s.app);
        const second = s.service.start({ ...s.app, id: s.app.id.toUpperCase() });
        await waitFor(() => s.queries.queryResource.mock.callCount() === 1);
        initial.resolve(logResult());
        await Promise.all([first, second]);
        expect(s.terminals).to.have.lengthOf(1);
        expect(s.terminals[0].show.mock.callCount()).to.equal(2);
        await s.service.start(s.app);
        expect(s.terminals[0].show.mock.callCount()).to.equal(3);
        expect(s.queries.queryResource.mock.callCount()).to.equal(1);
    });

    it('keeps streams for different account identities independent', async () => {
        const s = setup();
        await s.service.start(s.app);
        await s.service.start({
            ...s.app, subscription: makeSubscription({ ...s.app.subscription, accountId: 'another-account' }),
        });
        expect(s.terminals).to.have.lengthOf(2);
        expect(s.queries.queryResource.mock.callCount()).to.equal(2);
    });

    it('replays a bounded ingestion overlap without duplicates and accepts delayed or equal-time records', async () => {
        const s = setup();
        const timestamp = new Date(now - 60 * 60_000).toISOString();
        const first = new Date(now).toISOString();
        const later = new Date(now + 1000).toISOString();
        s.queries.queryResource.mock.mockImplementationOnce(() => Promise.resolve(logResult([
            [timestamp, later, 'second', 'second'],
            [timestamp, first, 'first', 'first'],
        ])), 0);
        s.queries.queryResource.mock.mockImplementation(() => Promise.resolve(logResult([
            [timestamp, first, 'first', 'first'],
            [timestamp, later, 'second', 'second'],
            [timestamp, first, 'delayed', 'delayed'],
            [timestamp, `${later.slice(0, -1)}1000Z`, 'same-time', 'same-time'],
        ])));
        const clock = mock.method(Date, 'now', () => now);
        await s.service.start(s.app);
        clock.mock.restore();
        await timers.whenScheduled();
        timers.tick(10_000);
        await waitFor(() => s.terminals[0].writes.some(text => text.includes('same-time')));
        const text = s.terminals[0].writes.join('');
        expect(text.match(/\] first\r\n/g)).to.have.lengthOf(1);
        expect(text.match(/\] second\r\n/g)).to.have.lengthOf(1);
        expect(text.match(/\] delayed\r\n/g)).to.have.lengthOf(1);
        expect(text.match(/\] same-time\r\n/g)).to.have.lengthOf(1);
        expect(text.indexOf('] first')).to.be.lessThan(text.indexOf('] second'));
        const query = s.queries.queryResource.mock.calls[1].arguments[1];
        expect(query).to.include('ingestion_time()');
        expect(query).to.include(new Date(now + 1000 - 5 * 60_000).toISOString());
        expect(query).to.include(s.app.name);
    });

    it('does not advance an empty poll past a delayed record', async () => {
        const s = setup();
        await s.service.start(s.app);
        const firstQuery = s.queries.queryResource.mock.calls[0].arguments[1];
        await timers.whenScheduled();
        timers.tick(10_000);
        await waitFor(() => s.queries.queryResource.mock.callCount() === 2);
        await timers.whenScheduled();
        const timestamp = new Date(now).toISOString();
        s.queries.queryResource.mock.mockImplementation(() => Promise.resolve(logResult([[timestamp, timestamp, 'late', 'late']])));
        timers.tick(10_000);
        await waitFor(() => s.terminals[0].writes.some(text => text.includes('] late')));
        expect(s.queries.queryResource.mock.calls[1].arguments[1]).to.equal(firstQuery);
        expect(s.queries.queryResource.mock.calls[2].arguments[1]).to.equal(firstQuery);
    });

    it('resolves a configured component in another accessible subscription of the same tenant', async () => {
        const subscription = makeSubscription({ subscriptionId: '99999999-0000-0000-0000-000000000000' });
        const s = setup({ insightsSubscription: subscription });
        await s.service.start(s.app);
        expect(s.resources.mock.calls.map(call => call.arguments[0].subscriptionId)).to.deep.equal([
            s.app.subscription.subscriptionId, subscription.subscriptionId,
        ]);
        expect(s.logs.mock.calls[0].arguments[0]).to.equal(subscription);
        expect(s.queries.queryResource.mock.calls[0].arguments[0]).to.equal(s.resource.id);
    });

    it('accepts connection string field casing and whitespace without copying it into the terminal', async () => {
        const connectionString = `  instrumentationKEY = ${TestInstrumentationKey.toUpperCase()} ;IngestionEndpoint=https://private.invalid`;
        const s = setup({ connectionString });
        await s.service.start(s.app);
        expect(s.terminals[0].writes.join('')).to.include('Application Insights logs');
        expect(s.terminals[0].writes.join('')).not.to.include('private.invalid');
    });

    it('discovers Application Insights from a differently cased connection string setting', async () => {
        const s = setup();
        const connection = s.web.settings.APPLICATIONINSIGHTS_CONNECTION_STRING;
        delete s.web.settings.APPLICATIONINSIGHTS_CONNECTION_STRING;
        s.web.settings.applicationinsights_connection_string = connection;

        await s.service.start(s.app);

        expect(s.queries.queryResource.mock.calls[0].arguments[0]).to.equal(s.resource.id);
        expect(s.terminals).to.have.lengthOf(1);
    });

    for (const connectionString of ['', 'InstrumentationKey=not-a-guid', 'IngestionEndpoint=https://example.invalid']) {
        it(`reports an unusable connection string before querying or creating a terminal: ${connectionString.length}`, async () => {
            const s = setup({ connectionString });
            await expect(s.service.start(s.app)).to.be.rejectedWith(/Configure APPLICATIONINSIGHTS_CONNECTION_STRING/);
            expect(s.queries.queryResource.mock.callCount()).to.equal(0);
            expect(s.terminals).to.be.empty;
        });
    }

    it('reports a missing component and permits a later corrected connection', async () => {
        const s = setup({ connectionString: 'InstrumentationKey=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });
        await expect(s.service.start(s.app)).to.be.rejectedWith(/Could not find/);
        expect(s.terminals).to.be.empty;
        s.web.settings.APPLICATIONINSIGHTS_CONNECTION_STRING = `InstrumentationKey=${TestInstrumentationKey}`;
        await s.service.start(s.app);
        expect(s.terminals).to.have.lengthOf(1);
    });

    it('surfaces ARM discovery permissions failures instead of presenting an empty log stream', async () => {
        const s = setup();
        mock.method(s.http, 'sendRequest', (request: Parameters<typeof s.http.sendRequest>[0]) => Promise.resolve(makeResponse(
            request, 403, JSON.stringify({ error: { code: 'Forbidden', message: 'Discovery denied' } }),
        )));
        await expect(s.service.start(s.app)).to.be.rejectedWith(/403/);
        expect(s.terminals).to.be.empty;
        expect(s.queries.queryResource.mock.callCount()).to.equal(0);
    });

    for (const invalid of [
        { tables: [] }, { tables: [{ name: 'result', columns: [], rows: [] }] },
        logResult([['not-a-date', 'not-a-date', 'id', 'message']]),
        logResult([[new Date(now).toISOString(), null, '', 'message']]),
    ]) {
        it('rejects an incomplete query schema or malformed record before opening a terminal', async () => {
            const s = setup();
            s.queries.queryResource.mock.mockImplementation(() => Promise.resolve(invalid));
            await expect(s.service.start(s.app)).to.be.rejected;
            expect(s.terminals).to.be.empty;
        });
    }

    it('preserves an initial query failure for concurrent callers and permits a retry', async () => {
        const s = setup();
        const query = Promise.withResolvers<LogsQueryResult>();
        s.queries.queryResource.mock.mockImplementation(() => query.promise);
        const first = expect(s.service.start(s.app)).to.be.rejectedWith('query denied');
        const second = expect(s.service.start(s.app)).to.be.rejectedWith('query denied');
        await waitFor(() => s.queries.queryResource.mock.callCount() === 1);
        query.reject(new Error('query denied'));
        await Promise.all([first, second]);
        expect(s.terminals).to.be.empty;
        s.queries.queryResource.mock.mockImplementation(() => Promise.resolve(logResult()));
        await s.service.start(s.app);
        expect(s.terminals).to.have.lengthOf(1);
    });

    it('keeps a polling failure visible in the terminal and starts a fresh session on retry', async () => {
        const s = setup();
        const error = mock.method(s.executor.output, 'error');
        await s.service.start(s.app);
        s.queries.queryResource.mock.mockImplementation(() => Promise.reject(new Error('poll rejected')));
        await timers.whenScheduled();
        timers.tick(10_000);
        await waitFor(() => s.terminals[0].writes.some(text => text.includes('poll rejected')));
        expect(error.mock.callCount()).to.equal(1);
        expect(JSON.stringify(error.mock.calls)).not.to.include('poll rejected');
        s.queries.queryResource.mock.mockImplementation(() => Promise.resolve(logResult()));
        await s.service.start(s.app);
        expect(s.terminals).to.have.lengthOf(2);
        s.terminals[0].pty.close();
        await s.service.start(s.app);
        expect(s.terminals[1].show.mock.callCount()).to.equal(2);
    });

    it('cancels an in-flight query and discards its late result on terminal close', async () => {
        const s = setup();
        await s.service.start(s.app);
        const next = Promise.withResolvers<LogsQueryResult>();
        s.queries.queryResource.mock.mockImplementation(() => next.promise);
        await timers.whenScheduled();
        timers.tick(10_000);
        await waitFor(() => s.queries.queryResource.mock.callCount() === 2);
        const signal = s.queries.queryResource.mock.calls[1].arguments[2]?.abortSignal;
        s.terminals[0].pty.close();
        expect(signal?.aborted).to.be.true;
        const timestamp = new Date(now).toISOString();
        next.resolve(logResult([[timestamp, timestamp, 'after-close', 'must not be written']]));
        await setImmediate();
        expect(timers.hasPending).to.be.false;
        timers.tick(30_000);
        await setImmediate();
        expect(s.queries.queryResource.mock.callCount()).to.equal(2);
        expect(s.terminals[0].writes.join('')).not.to.include('must not be written');
        expect(s.terminals[0].writes.join('')).not.to.include('Log stream failed');
    });

    it('cancels a scheduled poll when the terminal closes', async () => {
        const s = setup();
        await s.service.start(s.app);
        await timers.whenScheduled();
        s.terminals[0].pty.close();
        await setImmediate();
        expect(timers.hasPending).to.be.false;
        timers.tick(30_000);
        await setImmediate();
        expect(s.queries.queryResource.mock.callCount()).to.equal(1);
    });

    it('cancels initialization on disposal without creating a terminal after the query finishes', async () => {
        const s = setup();
        const initial = Promise.withResolvers<LogsQueryResult>();
        s.queries.queryResource.mock.mockImplementation(() => initial.promise);
        const start = s.service.start(s.app);
        const cancelled = expect(start).to.be.rejectedWith(CancellationError);
        await waitFor(() => s.queries.queryResource.mock.callCount() === 1);
        s.service.dispose();
        expect(s.queries.queryResource.mock.calls[0].arguments[2]?.abortSignal?.aborted).to.be.true;
        initial.resolve(logResult());
        await cancelled;
        expect(s.terminals).to.be.empty;
        await expect(s.service.start(s.app)).to.be.rejectedWith(CancellationError);
    });

    it('disposes active terminals and prevents delayed polling after disposal', async () => {
        const s = setup();
        await s.service.start(s.app);
        s.service.dispose();
        expect(s.terminals[0].dispose.mock.callCount()).to.equal(1);
        timers.tick(30_000);
        expect(s.queries.queryResource.mock.callCount()).to.equal(1);
    });
});
