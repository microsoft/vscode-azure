/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Client as RestClient, ClientOptions as RestClientOptions } from '@azure-rest/core-client';
import type { TokenCredential } from '@azure/core-auth';
import type { IActionExecutor, ICodeContext, SyncFactory } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import type { AzureSubscription } from '../../auth/AzureSubscription';
import type { EnvironmentLike } from '../../auth/Environment';
import { createDataPlaneRestClient } from '../createAzureClient';

export type LogsQueryClientOptions = RestClientOptions;

/** Factory that creates an {@linkcode ILogsQueryClient} for a subscription's cloud. */
export const ILogsQueryClientProvider: ServiceIdentifier<ILogsQueryClientProvider> = Symbol.for('ILogsQueryClientProvider');
export type ILogsQueryClientProvider = SyncFactory<ILogsQueryClient, [AzureSubscription]>;

/** Interface describing the Log Analytics query APIs we use. */
export interface ILogsQueryClient {
    /**
     * Runs a KQL query against a Log Analytics workspace and returns the first
     * result table as rows of plain strings.
     *
     * Returns an empty array when the query succeeds with no rows, and when it
     * fails: a diagnostic query is a best-effort enrichment of an error that has
     * already occurred, so failing to run it must not replace the original
     * error with a less useful one.
     *
     * @param workspaceId - The workspace's **customer id** (its GUID), not its
     *   ARM resource id.
     * @param timespanInMinutes - How far back to look, ending now.
     */
    queryWorkspace(workspaceId: string, query: string, timespanInMinutes: number): Promise<readonly string[]>;
}

/** Path segment carrying the API version, which the query endpoint takes in the URL rather than a query parameter. */
const LogsApiVersion = 'v1';

/**
 * One result column.
 *
 * Mirrors `Column` in `@azure/monitor-query-logs`.
 */
interface Column {
    readonly name: string;
    /** Kusto column type, e.g. `string`, `datetime`, `dynamic`. */
    readonly type: string;
}

/**
 * One result table.
 *
 * Mirrors `Table` in `@azure/monitor-query-logs`. Cells arrive as raw JSON, so
 * a `datetime` column is an ISO 8601 string rather than a `Date`.
 */
interface Table {
    readonly name: string;
    readonly columns: readonly Column[];
    readonly rows: readonly (readonly unknown[])[];
}

/**
 * Response body of `POST /v1/workspaces/{workspaceId}/query`.
 *
 * Mirrors `QueryResults` in `@azure/monitor-query-logs`. A partly-successful
 * query returns both `tables` and an `error`, so rows are still worth reading
 * when the service reports a failure.
 */
interface QueryResults {
    readonly tables: readonly Table[];
    readonly statistics?: unknown;
    readonly render?: unknown;
    readonly error?: unknown;
}

/**
 * Client for the Log Analytics query API.
 *
 * Issues the one query operation we need directly against the REST endpoint, so
 * requests run on the shared pipeline (see
 * {@linkcode createDataPlaneRestClient}) and no query SDK has to be bundled.
 *
 * Use the static {@linkcode create} factory to construct.
 */
export class LogsQueryClient implements ILogsQueryClient {
    private constructor(
        private readonly client: RestClient,
    ) { }

    /**
     * Create a new {@linkcode LogsQueryClient} for a cloud.
     *
     * @param environment - The cloud whose Log Analytics endpoint is queried and
     *   whose audience the credential is scoped to.
     */
    public static create(
        ctx: ICodeContext,
        executor: IActionExecutor,
        credential: TokenCredential,
        environment: EnvironmentLike,
        options?: LogsQueryClientOptions,
    ): LogsQueryClient {
        return new LogsQueryClient(createDataPlaneRestClient(ctx, executor, {
            name: 'logs',
            endpoint: `${environment.logAnalyticsEndpoint}/${LogsApiVersion}`,
            credential,
            scopes: [`${environment.logAnalyticsEndpoint}/.default`],
        }, options));
    }

    /** @inheritdoc */
    public async queryWorkspace(workspaceId: string, query: string, timespanInMinutes: number): Promise<readonly string[]> {
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - timespanInMinutes * 60 * 1000);

        try {
            const response = await this.client
                .pathUnchecked(`/workspaces/${encodeURIComponent(workspaceId)}/query`)
                .post({
                    body: {
                        query,
                        // The API takes a single ISO 8601 interval rather than a
                        // pair of instants.
                        timespan: `${startTime.toISOString()}/${endTime.toISOString()}`,
                    },
                });

            if (response.status !== '200') {
                return [];
            }

            // A partial failure still carries the rows it managed to read, and
            // partial logs still explain a failure, so they are kept rather
            // than discarded alongside the error.
            //
            // Parsing stays inside the `try` so a body that does not match the
            // declared shape yields no rows rather than replacing the caller's
            // original error with a parse failure.
            const rows = (response.body as QueryResults).tables.at(0)?.rows;
            if (!rows) {
                return [];
            }

            // Rows are heterogeneous cell arrays; the callers of this are
            // attaching log text to an activity, so each row is flattened to
            // one line.
            return rows.map(row => row.map(cell => formatCell(cell)).join(' '));
        } catch {
            return [];
        }
    }
}

/** Renders one result cell as text, without leaking `[object Object]`. */
function formatCell(cell: unknown): string {
    if (cell === null || cell === undefined) {
        return '';
    }
    if (typeof cell === 'string') {
        return cell;
    }
    if (typeof cell === 'number' || typeof cell === 'boolean') {
        return cell.toString();
    }
    return JSON.stringify(cell);
}
