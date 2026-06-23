/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AccountCacheFormatVersion, type CachedAccountData } from '@microsoft/vscode-azure-azutils';
import { IActionExecutor, ICodeContext, stringifyError } from '@microsoft/vscode-azure-utils';
import { inject, injectable, type ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';

/** Identifier for the {@linkcode AccountCacheStore} service. */
export const IAccountCacheStore: ServiceIdentifier<IAccountCacheStore> = Symbol.for('IAccountCacheStore');

/**
 * Persists a snapshot of the account → tenant → subscription tree so the
 * resources view can render last-known data instantly on the next activation,
 * while a live refresh runs in the background (see `AzureAccountDataProvider`).
 */
export interface IAccountCacheStore {
    /**
     * Read the persisted snapshot, or `undefined` when there is no usable cache
     * (missing file, unreadable, malformed, or an unrecognized format version).
     * Never throws; failures are logged and treated as a cache miss.
     */
    load(): Promise<CachedAccountData | undefined>;

    /**
     * Persist a snapshot, overwriting any previous one. Writes are serialized so
     * overlapping calls cannot interleave on disk; the last call wins. Never
     * throws; failures are logged and swallowed (the cache is best-effort).
     */
    save(data: CachedAccountData): Promise<void>;

    /** Delete the persisted snapshot, if any. Never throws. */
    clear(): Promise<void>;
}

/** File name (under the extension's global storage directory) for the snapshot. */
const AccountCacheFileName = 'accountCache.json';

/**
 * Filesystem-backed {@linkcode IAccountCacheStore} that stores the snapshot as a
 * single JSON file under {@linkcode vscode.ExtensionContext.globalStorageUri}
 * (per-machine, shared across workspaces -- accounts are not workspace-scoped).
 *
 * All IO goes through `vscode.workspace.fs`. The store is intentionally tolerant:
 * any read failure (including a missing directory/file or JSON parse error) is
 * reported as a cache miss rather than an error, and write failures are logged
 * and swallowed so a broken cache never degrades the live experience.
 */
@injectable()
export class AccountCacheStore implements IAccountCacheStore {
    private readonly directoryUri: vscode.Uri;
    private readonly fileUri: vscode.Uri;

    /**
     * Tail of the serialized write chain. Each {@linkcode save}/{@linkcode clear}
     * appends to this so disk writes run one at a time in call order, regardless
     * of whether a prior write resolved or rejected.
     */
    private writeQueue: Promise<void> = Promise.resolve();

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
    ) {
        this.directoryUri = this.ctx.extensionContext.globalStorageUri;
        this.fileUri = this.ctx.code.Uri.joinPath(this.directoryUri, AccountCacheFileName);
    }

    /** @inheritdoc */
    public async load(): Promise<CachedAccountData | undefined> {
        let text: string;
        try {
            const bytes = await this.ctx.code.workspace.fs.readFile(this.fileUri);
            text = new TextDecoder().decode(bytes);
        } catch {
            // Missing file (the common cold-cache case) or unreadable: cache miss.
            this.executor.output.trace('[accountCache] no persisted cache found');
            return undefined;
        }

        try {
            const parsed = JSON.parse(text) as unknown;
            if (!isCachedAccountData(parsed)) {
                this.executor.output.debug('[accountCache] persisted cache is malformed; ignoring');
                return undefined;
            }
            if (parsed.version !== AccountCacheFormatVersion) {
                this.executor.output.debug(`[accountCache] persisted cache version ${parsed.version} != ${AccountCacheFormatVersion}; ignoring`);
                return undefined;
            }
            this.executor.output.trace(`[accountCache] loaded persisted cache (accounts=${parsed.accounts.length})`);
            return parsed;
        } catch (error) {
            this.executor.output.debug(`[accountCache] failed to parse persisted cache: ${stringifyError(error)}`);
            return undefined;
        }
    }

    /** @inheritdoc */
    public save(data: CachedAccountData): Promise<void> {
        return this.enqueue(() => this.writeNow(data));
    }

    /** @inheritdoc */
    public clear(): Promise<void> {
        return this.enqueue(() => this.deleteNow());
    }

    /** Append `op` to the serialized write chain, isolating its rejection. */
    private enqueue(op: () => Promise<void>): Promise<void> {
        const next = this.writeQueue.then(op, op);
        // Swallow rejections on the chain itself so one failure does not reject
        // every future write; each op already logs its own failure.
        this.writeQueue = next.catch(() => { /* already logged */ });
        return next;
    }

    private async writeNow(data: CachedAccountData): Promise<void> {
        try {
            await this.ctx.code.workspace.fs.createDirectory(this.directoryUri);
            const bytes = new TextEncoder().encode(JSON.stringify(data));
            await this.ctx.code.workspace.fs.writeFile(this.fileUri, bytes);
            this.executor.output.trace(`[accountCache] persisted cache (accounts=${data.accounts.length})`);
        } catch (error) {
            this.executor.output.warn(`[accountCache] failed to persist cache: ${stringifyError(error)}`);
        }
    }

    private async deleteNow(): Promise<void> {
        try {
            await this.ctx.code.workspace.fs.delete(this.fileUri);
            this.executor.output.trace('[accountCache] cleared persisted cache');
        } catch {
            // Nothing to delete (or already gone): not an error.
        }
    }
}

/** Narrow an arbitrary parsed value to a {@linkcode CachedAccountData} shape. */
function isCachedAccountData(value: unknown): value is CachedAccountData {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as { version?: unknown; environment?: unknown; accounts?: unknown };
    if (typeof candidate.version !== 'number' || !Array.isArray(candidate.accounts)) {
        return false;
    }
    const environment = candidate.environment;
    if (typeof environment !== 'object' || environment === null) {
        return false;
    }
    return typeof (environment as { name?: unknown }).name === 'string';
}
