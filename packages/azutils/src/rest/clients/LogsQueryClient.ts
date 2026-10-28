/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Client, ClientOptions, OperationOptions } from '@azure-rest/core-client';
import type { TokenCredential } from '@azure/core-auth';
import { RestError } from '@azure/core-rest-pipeline';
import type { IActionExecutor, ICodeContext, SyncFactory } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import type { AzureSubscriptionTarget } from '../../auth/AzureSubscription';
import { parseAzureResourceId, type ParsedAzureResourceId } from '../../utils/azureResourceId';
import { assertRestSuccess } from '../assertRestSuccess';
import { createDataPlaneRestClient } from '../createAzureClient';

export type { ClientOptions as LogsQueryClientOptions };

/** A query's wire schema; values retain their service-provided JSON representation. */
export interface LogsQueryTable {
    readonly name: string;
    readonly columns: readonly { readonly name: string; readonly type: string }[];
    readonly rows: readonly (readonly unknown[])[];
}

/** The tables from a complete Azure Monitor Logs query. */
export interface LogsQueryResult {
    readonly tables: readonly LogsQueryTable[];
}

/** Request cancellation, transport options, and an optional ISO 8601 query interval. */
export interface LogsQueryOptions extends OperationOptions {
    readonly timespan?: string;
}

/** Shared Azure Monitor Logs operations for Application Insights resources and workspaces. */
export interface ILogsQueryClient {
    queryResource(resourceId: string, query: string, options?: LogsQueryOptions): Promise<LogsQueryResult>;
    queryWorkspace(workspaceId: string, query: string, options?: LogsQueryOptions): Promise<LogsQueryResult>;
}

/** Creates a query client using the subscription's cloud and identity. */
export const ILogsQueryClientProvider: ServiceIdentifier<ILogsQueryClientProvider> = Symbol.for('ILogsQueryClientProvider');
export type ILogsQueryClientProvider = SyncFactory<ILogsQueryClient, [AzureSubscriptionTarget]>;

/**
 * Queries Azure Monitor through the shared data-plane REST pipeline.
 *
 * Request and response contracts:
 * https://learn.microsoft.com/azure/azure-monitor/logs/api/azure-resource-queries
 * https://learn.microsoft.com/azure/azure-monitor/logs/api/response-format
 * Partial query failures throw rather than appearing as a complete log stream.
 */
export class LogsQueryClient implements ILogsQueryClient {
    private constructor(
        private readonly ctx: ICodeContext,
        private readonly inner: Client,
    ) { }

    /** Creates a lightweight client without acquiring a token or querying logs. */
    public static create(
        ctx: ICodeContext,
        executor: IActionExecutor,
        credential: TokenCredential,
        subscription: AzureSubscriptionTarget,
        options?: ClientOptions,
    ): LogsQueryClient {
        const endpoint = subscription.environment.logAnalyticsEndpoint;
        const inner = createDataPlaneRestClient(ctx, executor, {
            name: 'logs-query',
            endpoint,
            credential,
            scopes: [`${endpoint}/.default`],
            dedupeIdentity: subscription.accountId && subscription.tenantId
                ? { accountId: subscription.accountId, tenantId: subscription.tenantId }
                : undefined,
        }, options);
        return new LogsQueryClient(ctx, inner);
    }

    /** Queries logs in resource context, including workspace-based Application Insights. */
    public queryResource(resourceId: string, query: string, options?: LogsQueryOptions): Promise<LogsQueryResult> {
        const invalidIdMessage = this.ctx.code.l10n.t('A fully qualified Azure resource ID is required to query logs.');
        let parsed: ParsedAzureResourceId;
        try {
            parsed = parseAzureResourceId(resourceId);
        } catch {
            throw new TypeError(invalidIdMessage);
        }
        const segments = parsed.resourceId.split('/').filter(Boolean);
        if (!parsed.resourceType || !parsed.resourceName
            || resourceId.includes('?') || resourceId.includes('#')
            || segments.some(segment => segment === '.' || segment === '..')) {
            throw new TypeError(invalidIdMessage);
        }
        const path = segments.map(encodeURIComponent).join('/');
        return this.query(`/v1/${path}/query`, query, options);
    }

    /** Queries logs by the workspace's GUID, not its ARM resource ID. */
    public queryWorkspace(workspaceId: string, query: string, options?: LogsQueryOptions): Promise<LogsQueryResult> {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workspaceId)) {
            throw new TypeError(this.ctx.code.l10n.t('A Log Analytics workspace GUID is required.'));
        }
        return this.query(`/v1/workspaces/${workspaceId}/query`, query, options);
    }

    private async query(path: string, query: string, options?: LogsQueryOptions): Promise<LogsQueryResult> {
        if (!query.trim()) {
            throw new TypeError(this.ctx.code.l10n.t('A log query is required.'));
        }
        const response = await this.inner.pathUnchecked(path).post({
            ...options?.requestOptions,
            allowInsecureConnection: false,
            abortSignal: options?.abortSignal,
            tracingOptions: options?.tracingOptions,
            onResponse: options?.onResponse,
            contentType: 'application/json',
            body: { query, timespan: options?.timespan },
        });
        if (Number(response.status) === 400) {
            const codes = errorCodes(response.body);
            throw new RestError(codes.length
                ? this.ctx.code.l10n.t('The log query was rejected ({0}).', codes.join(', '))
                : this.ctx.code.l10n.t('The log query was rejected.'), { statusCode: 400 });
        }
        assertRestSuccess(this.ctx.code, response);
        const body: unknown = response.body;
        if (body && typeof body === 'object' && 'error' in body) {
            throw new RestError(this.ctx.code.l10n.t('The log query returned incomplete results.'), { code: 'PartialError' });
        }
        if (!body || typeof body !== 'object' || !('tables' in body)
            || !Array.isArray(body.tables) || !body.tables.every(isQueryTable)) {
            throw new RestError(this.ctx.code.l10n.t('Azure Monitor returned an invalid log query result.'));
        }
        return { tables: body.tables };
    }
}

/**
 * Collects the machine-readable codes of a rejected query's nested `error` chain. Messages are
 * never copied, since they can quote query text; only short identifier-shaped codes are kept.
 */
function errorCodes(body: unknown): string[] {
    const codes: string[] = [];
    let current: unknown = body && typeof body === 'object' && 'error' in body ? body.error : undefined;
    while (current && typeof current === 'object' && codes.length < 5) {
        if ('code' in current && typeof current.code === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(current.code)) {
            codes.push(current.code);
        }
        current = 'innererror' in current ? current.innererror : undefined;
    }
    return codes;
}

function isQueryTable(value: unknown): value is LogsQueryTable {
    if (!value || typeof value !== 'object'
        || !('name' in value) || typeof value.name !== 'string'
        || !('columns' in value) || !Array.isArray(value.columns)
        || !('rows' in value) || !Array.isArray(value.rows)) {
        return false;
    }
    const columnCount = value.columns.length;
    return value.columns.every((column: unknown) => !!column && typeof column === 'object'
        && 'name' in column && typeof column.name === 'string'
        && 'type' in column && typeof column.type === 'string')
        && value.rows.every((row: unknown) => Array.isArray(row) && row.length === columnCount);
}
