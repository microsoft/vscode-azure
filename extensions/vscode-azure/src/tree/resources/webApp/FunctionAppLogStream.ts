/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ApplicationInsightsResourceType, AzureNodeId, IAzureListingCache, ILogsQueryClientProvider, IResourceClientProvider,
    type AzureListingCache, type AzureSubscription, type GenericResource, type ILogsQueryClient, type LogsQueryResult,
} from '@microsoft/vscode-azure-azutils';
import { CancellationError, CaselessMap, delay, ExternalError, IActionExecutor, IVsCode, stringifyError, type Disposable } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import { WebAppSettingsAdapter } from '../../../settings/adapters/WebAppSettingsAdapter';
import { BufferedPseudoterminal } from '../../../utils/BufferedPseudoterminal';
import type { FunctionApp } from './FunctionApp';

interface Stream {
    readonly abort: AbortController;
    readonly ready: Promise<void>;
    terminal?: vscode.Terminal;
}

interface LogRecord {
    readonly timestamp: string;
    readonly ingested: number;
    readonly id: string;
    readonly message: string;
}

const LookbackMs = 5 * 60_000;

/** Workspace-based components expose the Log Analytics `App*` tables; classic components expose `traces` and `requests`. */
function isWorkspaceBased(resource: GenericResource): boolean {
    const properties: unknown = resource.properties;
    return !!properties && typeof properties === 'object'
        && Object.entries(properties).some(([key, value]) => key.toLowerCase() === 'workspaceresourceid' && typeof value === 'string' && !!value);
}

/** Owns one cancellable Application Insights log terminal per Function App. */
@injectable()
export class FunctionAppLogStream implements Disposable {
    private readonly streams = new CaselessMap<Stream>();
    private disposed = false;

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(WebAppSettingsAdapter) private readonly settings: WebAppSettingsAdapter,
        @inject(IResourceClientProvider) private readonly createResources: IResourceClientProvider,
        @inject(ILogsQueryClientProvider) private readonly createLogs: ILogsQueryClientProvider,
        @inject(IAzureListingCache) private readonly listings: AzureListingCache,
    ) { }

    /** Concurrent starts share discovery and the initial query; an open stream is focused again. */
    public async start(app: FunctionApp): Promise<void> {
        if (this.disposed) {
            throw new CancellationError();
        }
        const key = AzureNodeId.from(app).toString();
        const existing = this.streams.get(key);
        if (existing) {
            await existing.ready;
            if (!existing.abort.signal.aborted) {
                existing.terminal?.show();
            }
            return;
        }
        const stream: Stream = {
            abort: new AbortController(),
            ready: Promise.resolve().then(() => this.open(app, stream)),
        };
        this.streams.set(key, stream);
        return stream.ready;
    }

    private async open(app: FunctionApp, stream: Stream): Promise<void> {
        const signal = stream.abort.signal;
        try {
            const resource = await this.resolveInsights(app, signal);
            const workspaceBased = isWorkspaceBased(resource);
            const client = this.createLogs(resource.subscription);
            const cursor = Date.now() - LookbackMs;
            const first = this.records(await client.queryResource(resource.id, this.query(app.name, cursor, workspaceBased), { abortSignal: signal, timespan: 'P2D' }));
            signal.throwIfAborted();
            const pty = new BufferedPseudoterminal({
                onClose: () => { this.stop(AzureNodeId.from(app).toString(), stream, false); },
            });
            stream.terminal = this.code.window.createTerminal({ name: this.code.l10n.t('Logs: {0}', app.name), pty });
            pty.write(this.code.l10n.t('Application Insights logs. Events can appear after an ingestion delay.\n'));
            stream.terminal.show();
            void this.poll(app, resource.id, workspaceBased, client, stream, pty, cursor, first);
        } catch (error: unknown) {
            const cancelled = signal.aborted;
            this.stop(AzureNodeId.from(app).toString(), stream, true);
            if (cancelled && error instanceof Error && error.name === 'AbortError') {
                throw new CancellationError();
            }
            throw error;
        }
    }

    private async resolveInsights(app: FunctionApp, signal: AbortSignal): Promise<GenericResource> {
        signal.throwIfAborted();
        const snapshot = await this.settings.read(app);
        signal.throwIfAborted();
        const values = new CaselessMap(snapshot.entries.map(entry => [entry.key, entry.value]));
        const connection = values.get('APPLICATIONINSIGHTS_CONNECTION_STRING');
        const keyField = connection?.split(';').find(part => /^\s*InstrumentationKey\s*=/i.test(part));
        const instrumentationKey = keyField?.slice(keyField.indexOf('=') + 1).trim();
        if (!instrumentationKey || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(instrumentationKey)) {
            throw new ExternalError(this.code.l10n.t('Configure APPLICATIONINSIGHTS_CONNECTION_STRING with an instrumentation key to stream function logs.'));
        }
        const own = await this.findInsights(app.subscription, instrumentationKey, signal);
        if (own) {
            return own;
        }
        for await (const { subscription } of this.listings.walkSubscriptions()) {
            signal.throwIfAborted();
            if (subscription.accountId.toLowerCase() !== app.subscription.accountId.toLowerCase()
                || subscription.tenantId.toLowerCase() !== app.subscription.tenantId.toLowerCase()
                || subscription.subscriptionId.toLowerCase() === app.subscription.subscriptionId.toLowerCase()) {
                continue;
            }
            const resource = await this.findInsights(subscription, instrumentationKey, signal);
            if (resource) {
                return resource;
            }
        }
        throw new ExternalError(this.code.l10n.t('Could not find the configured Application Insights resource in an accessible subscription.'));
    }

    private async findInsights(subscription: AzureSubscription, instrumentationKey: string, signal: AbortSignal): Promise<GenericResource | undefined> {
        const client = this.createResources(subscription);
        for await (const page of client.resources.list({ filter: `resourceType eq '${ApplicationInsightsResourceType}'`, abortSignal: signal })) {
            for (const resource of page.items) {
                signal.throwIfAborted();
                if (resource.type.toLowerCase() !== ApplicationInsightsResourceType.toLowerCase()) {
                    continue;
                }
                const details = await client.resources.getById(resource.id, ApplicationInsightsResourceType, { abortSignal: signal });
                const properties: unknown = details.properties;
                if (properties && typeof properties === 'object'
                    && 'InstrumentationKey' in properties && typeof properties.InstrumentationKey === 'string'
                    && properties.InstrumentationKey.toLowerCase() === instrumentationKey.toLowerCase()) {
                    return details;
                }
            }
        }
        return undefined;
    }

    /**
     * Queries only the tables the component's schema has. A fuzzy union over both schemas makes the service report
     * a partial error for whichever tables are absent, which this stream must treat as a failure.
     */
    private query(role: string, cursor: number, workspaceBased: boolean): string {
        const tables = workspaceBased ? 'AppTraces, AppRequests' : 'traces, requests';
        return `union ${tables}
| extend Timestamp = coalesce(column_ifexists('TimeGenerated', datetime(null)), column_ifexists('timestamp', datetime(null))),
         Role = coalesce(tostring(column_ifexists('AppRoleName', '')), tostring(column_ifexists('cloud_RoleName', ''))),
         Message = coalesce(tostring(column_ifexists('Message', '')), tostring(column_ifexists('message', '')), tostring(column_ifexists('Name', '')), tostring(column_ifexists('name', ''))),
         ItemId = coalesce(tostring(column_ifexists('_ItemId', '')), tostring(column_ifexists('itemId', '')), tostring(column_ifexists('Id', '')), tostring(column_ifexists('id', '')))
| extend Ingested = ingestion_time()
| where Ingested >= datetime(${new Date(cursor).toISOString()})
| where Role =~ ${JSON.stringify(role)}
| project Timestamp, Ingested, ItemId, Message
| order by Ingested asc, ItemId asc`;
    }

    private records(result: LogsQueryResult): LogRecord[] {
        const table = result.tables.at(0);
        if (!table) {
            throw new Error(this.code.l10n.t('The function log query returned no table.'));
        }
        const timestamp = table.columns.findIndex(column => column.name === 'Timestamp');
        const ingested = table.columns.findIndex(column => column.name === 'Ingested');
        const id = table.columns.findIndex(column => column.name === 'ItemId');
        const message = table.columns.findIndex(column => column.name === 'Message');
        if ([timestamp, ingested, id, message].some(index => index < 0)) {
            throw new Error(this.code.l10n.t('The function log query returned an invalid schema.'));
        }
        return table.rows.map(row => {
            const time = row[timestamp];
            const received = row[ingested];
            const itemId = row[id];
            const text = row[message];
            if (typeof time !== 'string' || !Number.isFinite(Date.parse(time))
                || typeof received !== 'string' || !Number.isFinite(Date.parse(received))
                || typeof itemId !== 'string' || !itemId
                || typeof text !== 'string') {
                throw new Error(this.code.l10n.t('The function log query returned an invalid record.'));
            }
            return { timestamp: time, ingested: Date.parse(received), id: itemId, message: text };
        }).sort((left, right) => left.ingested - right.ingested);
    }

    private async poll(
        app: FunctionApp,
        resourceId: string,
        workspaceBased: boolean,
        client: ILogsQueryClient,
        stream: Stream,
        pty: BufferedPseudoterminal,
        cursor: number,
        records: LogRecord[],
    ): Promise<void> {
        const signal = stream.abort.signal;
        const initialCursor = cursor;
        const seen = new Map<string, number>();
        try {
            for (;;) {
                signal.throwIfAborted();
                for (const record of records) {
                    if (seen.has(record.id)) {
                        continue;
                    }
                    cursor = Math.max(cursor, record.ingested);
                    seen.set(record.id, record.ingested);
                    pty.write(`[${record.timestamp}] ${record.message}\n`);
                }
                const windowStart = Math.max(initialCursor, cursor - LookbackMs);
                for (const [id, ingested] of seen) {
                    if (ingested < windowStart) {
                        seen.delete(id);
                    }
                }
                await delay(10_000, signal);
                records = this.records(await client.queryResource(resourceId, this.query(app.name, windowStart, workspaceBased), { abortSignal: signal, timespan: 'P2D' }));
            }
        } catch (error: unknown) {
            if (!signal.aborted) {
                pty.write(this.code.l10n.t('Log stream failed: {0}\n', stringifyError(error)));
                this.executor.output.error(this.code.l10n.t('[data] Function log stream failed for \'{0}\'.', app.name));
                pty.finish(1);
            }
        } finally {
            const key = AzureNodeId.from(app).toString();
            if (this.streams.get(key) === stream) {
                this.streams.delete(key);
            }
        }
    }

    private stop(id: string, stream: Stream, disposeTerminal: boolean): void {
        if (this.streams.get(id) === stream) {
            this.streams.delete(id);
        }
        stream.abort.abort(new CancellationError());
        if (disposeTerminal) {
            stream.terminal?.dispose();
        }
    }

    /** Cancels polling and in-flight queries and disposes every active terminal. */
    public dispose(): void {
        this.disposed = true;
        for (const [id, stream] of this.streams) {
            this.stop(id, stream, true);
        }
    }
}
