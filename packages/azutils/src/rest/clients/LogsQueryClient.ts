/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TokenCredential } from '@azure/core-auth';
import {
    LogsQueryClient as SdkLogsQueryClient, LogsQueryResultStatus,
    type LogsQueryClientOptions, type LogsQueryResult,
} from '@azure/monitor-query-logs';
import type { SyncFactory } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import type { AzureSubscription } from '../../auth/AzureSubscription';
import type { EnvironmentLike } from '../../auth/Environment';

export type { LogsQueryClientOptions };

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

/**
 * Wrapper around the `@azure/monitor-query-logs` SDK.
 *
 * Supersedes `@azure/monitor-query`, which the Azure SDK team deprecated in
 * favor of the split `-logs` and `-metrics` packages.
 *
 * Use the static {@linkcode create} factory to construct.
 */
export class LogsQueryClient implements ILogsQueryClient {
    private constructor(
        private readonly inner: SdkLogsQueryClient,
    ) { }

    /**
     * Create a new {@linkcode LogsQueryClient} for a cloud.
     *
     * @param environment - The cloud whose Log Analytics endpoint is queried and
     *   whose audience the credential is scoped to.
     */
    public static create(
        credential: TokenCredential,
        environment: EnvironmentLike,
        options?: LogsQueryClientOptions,
    ): LogsQueryClient {
        return new LogsQueryClient(new SdkLogsQueryClient(credential, {
            endpoint: environment.logAnalyticsEndpoint,
            audience: environment.logAnalyticsEndpoint,
            ...options,
        }));
    }

    /** @inheritdoc */
    public async queryWorkspace(workspaceId: string, query: string, timespanInMinutes: number): Promise<readonly string[]> {
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - timespanInMinutes * 60 * 1000);

        let result: LogsQueryResult;
        try {
            result = await this.inner.queryWorkspace(workspaceId, query, { startTime, endTime });
        } catch {
            return [];
        }

        // A partial failure still carries the rows it managed to read, and
        // partial logs still explain a failure, so they are kept rather than
        // discarded alongside the error.
        // `.at()` rather than `[0]`: an empty table array is possible at
        // runtime, which the SDK's index signature does not model.
        const table = result.status === LogsQueryResultStatus.PartialFailure
            ? result.partialTables.at(0)
            : result.tables.at(0);

        if (!table) {
            return [];
        }

        // Rows are heterogeneous cell arrays; the callers of this are attaching
        // log text to an activity, so each row is flattened to one line.
        return table.rows.map(row => row.map((cell: unknown) => formatCell(cell)).join(' '));
    }
}

/** Renders one result cell as text, without leaking `[object Object]`. */
function formatCell(cell: unknown): string {
    if (cell === null || cell === undefined) {
        return '';
    }
    if (cell instanceof Date) {
        return cell.toISOString();
    }
    if (typeof cell === 'string') {
        return cell;
    }
    if (typeof cell === 'number' || typeof cell === 'boolean') {
        return cell.toString();
    }
    return JSON.stringify(cell);
}
