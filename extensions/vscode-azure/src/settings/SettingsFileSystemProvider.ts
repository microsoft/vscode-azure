/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { Disposable, EventEmitter, stringifyError, type IVsCode } from '@microsoft/vscode-azure-utils';
import type { IAzureViewDataTree } from '../services';
import { isSettingsNode, type SettingsNode } from '../tree/resources/settings/SettingsNode';
import { JsoncSettingsFormat } from './JsoncSettingsFormat';
import type { SettingsAdapter } from './SettingsAdapter';
import type { SettingsSnapshot } from './SettingsModel';
import { SettingsUri } from './SettingsUri';

/** Options for {@linkcode SettingsFileSystemProvider}. */
export interface SettingsFileSystemProviderOptions {
    /**
     * How long a snapshot read for {@linkcode SettingsFileSystemProvider.stat stat} may be reused to
     * satisfy an immediately following {@linkcode SettingsFileSystemProvider.readFile readFile},
     * in milliseconds.
     *
     * The editor always calls `stat` then `readFile` when opening a document; without this window
     * every open would cost two round trips to the service. It is deliberately short so an explicit
     * reload still fetches fresh data. Defaults to 3000.
     */
    readonly freshnessWindowMs?: number;
}

interface CacheEntry {
    readonly snapshot: SettingsSnapshot;
    /** Text last handed to the editor, used for `size` in {@linkcode vscode.FileStat}. */
    readonly text: string;
    readonly loadedAt: number;
    readonly mtime: number;
}

const DefaultFreshnessWindowMs = 3000;

/**
 * A {@linkcode vscode.FileSystemProvider} that presents a resource's settings as a single editable
 * text document.
 *
 * A settings URI carries the settings node's tree key, so the provider resolves one with a direct
 * lookup in the data tree and hands the adapter **the object the tree loaded from Azure** -- never
 * one rebuilt from the URI, which could silently disagree with reality. The consequence is that a
 * document only resolves while its node is in the tree: that covers the ordinary case, since the
 * document is opened from the tree and the tree caches it, but a document restored by the editor
 * after a window reload will not resolve until that node has loaded.
 *
 * Saving writes to the backing service **as-is** -- the parsed document becomes the complete new
 * contents, so removing a key deletes that setting and a key changed elsewhere since the document
 * was opened is silently overwritten. This last-writer-wins behavior is deliberate: it makes the
 * document mean exactly what it appears to mean. The header rendered by
 * {@linkcode JsoncSettingsFormat} states it.
 *
 * @remarks
 * Documents exist only in memory. Nothing is written to disk unless the user explicitly saves a
 * copy, which would store the values in plain text.
 */
export class SettingsFileSystemProvider implements vscode.FileSystemProvider, Disposable {
    private readonly changeEmitter = new EventEmitter<vscode.FileChangeEvent[]>();
    private readonly cache = new Map<string, CacheEntry>();
    private readonly freshnessWindowMs: number;
    private readonly format: JsoncSettingsFormat;

    public constructor(
        private readonly code: IVsCode,
        private readonly tree: IAzureViewDataTree,
        private readonly adapters: readonly SettingsAdapter[],
        options?: SettingsFileSystemProviderOptions,
    ) {
        this.freshnessWindowMs = options?.freshnessWindowMs ?? DefaultFreshnessWindowMs;
        this.format = new JsoncSettingsFormat(code);
    }

    /** @inheritdoc */
    public readonly onDidChangeFile = this.changeEmitter.event;

    /** @inheritdoc */
    public watch(): Disposable {
        return Disposable.None;
    }

    /**
     * @inheritdoc
     * @throws `FileNotFound` if the URI cannot be resolved to a settings node and adapter.
     */
    public async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const entry = await this.load(uri, { allowReuse: false });

        return {
            type: this.code.FileType.File,
            ctime: entry.mtime,
            mtime: entry.mtime,
            size: Buffer.byteLength(entry.text, 'utf8'),
            // Per-file, rather than provider-wide, so read-only settings on one resource do
            // not make every settings document read-only.
            permissions: entry.snapshot.writable ? undefined : this.code.FilePermission.Readonly,
        };
    }

    /**
     * @inheritdoc
     * @throws `FileNotFound` if the URI cannot be resolved to a settings node and adapter.
     */
    public async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const entry = await this.load(uri, { allowReuse: true });
        return Buffer.from(entry.text, 'utf8');
    }

    /**
     * @inheritdoc
     *
     * Parses the document and writes it as the resource's complete new settings.
     *
     * @throws `NoPermissions` if the settings are not writable, or the
     * {@linkcode SettingsParseError} raised by the format if the document is not valid. Parse errors
     * are surfaced unchanged so the caller can point the user at the offending span.
     *
     * @remarks
     * `options` is ignored: a settings document always exists and is always overwritten wholesale,
     * so neither `create` nor `overwrite` can be false in a way that means anything here.
     */
    public async writeFile(uri: vscode.Uri, content: Uint8Array, _options: { readonly create: boolean; readonly overwrite: boolean }): Promise<void> {
        const entry = await this.load(uri, { allowReuse: true });

        if (!entry.snapshot.writable) {
            throw this.code.FileSystemError.NoPermissions(uri);
        }

        const parsed = this.format.parse(Buffer.from(content).toString('utf8'));

        const { node, adapter } = this.resolve(uri);
        await adapter.write(node.azureResource, parsed);

        // The node itself is a leaf today, so this is cheap insurance rather than a visible refresh:
        // it keeps the data layer honest if a resource ever grows children derived from its settings.
        this.tree.invalidate(node);

        // Reflect what was just written rather than re-reading. A re-read would cost a round trip
        // and, under last-writer-wins, could only differ by a concurrent change that this write has
        // already overwritten.
        const snapshot: SettingsSnapshot = { ...entry.snapshot, entries: parsed };
        this.store(uri, snapshot);

        this.changeEmitter.fire([{ type: this.code.FileChangeType.Changed, uri }]);
    }

    /**
     * @inheritdoc
     * @throws `FileNotFound` always -- a settings URI names a document, never a directory.
     */
    public readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
        throw this.code.FileSystemError.FileNotFound(uri);
    }

    /**
     * @inheritdoc
     * @throws `NoPermissions` always -- the settings namespace is not a writable directory tree.
     */
    public createDirectory(uri: vscode.Uri): void {
        throw this.code.FileSystemError.NoPermissions(uri);
    }

    /**
     * @inheritdoc
     * @throws `NoPermissions` always. Deleting the document is not the same as deleting the
     * settings, and silently doing either would be surprising; use the delete-setting command.
     */
    public delete(uri: vscode.Uri): void {
        throw this.code.FileSystemError.NoPermissions(uri);
    }

    /**
     * @inheritdoc
     * @throws `NoPermissions` always -- a settings document's name is derived from its resource.
     */
    public rename(oldUri: vscode.Uri): void {
        throw this.code.FileSystemError.NoPermissions(oldUri);
    }

    /** @inheritdoc */
    public dispose(): void {
        this.cache.clear();
        this.changeEmitter.dispose();
    }

    /**
     * Resolve the settings node a URI addresses, and the adapter that serves it.
     *
     * @throws if the URI is malformed, its node is not currently in the tree, or no adapter claims
     * the node's resource.
     */
    private resolve(uri: vscode.Uri): { node: SettingsNode; adapter: SettingsAdapter } {
        const node = this.tree.get(SettingsUri.parseNodeKey(uri));

        if (!isSettingsNode(node)) {
            throw new Error(this.code.l10n.t('These settings are no longer available. Open them again from the Azure view.'));
        }

        const adapter = this.adapters.find(candidate => candidate.canHandle(node.azureResource));
        if (!adapter) {
            throw new Error(`No settings adapter is registered for resources of type '${node.azureResource.logicalType}'`);
        }

        return { node, adapter };
    }

    private async load(uri: vscode.Uri, options: { allowReuse: boolean }): Promise<CacheEntry> {
        const cached = this.cache.get(uri.toString());
        if (cached && options.allowReuse && Date.now() - cached.loadedAt < this.freshnessWindowMs) {
            return cached;
        }

        let snapshot: SettingsSnapshot;
        try {
            const { node, adapter } = this.resolve(uri);
            snapshot = await adapter.read(node.azureResource);
        } catch (error) {
            // The editor only acts on `FileNotFound`; anything else surfaces as an opaque failure.
            // Preserve the original message so the cause is not lost.
            throw this.code.FileSystemError.FileNotFound(stringifyError(error));
        }

        return this.store(uri, snapshot);
    }

    private store(uri: vscode.Uri, snapshot: SettingsSnapshot): CacheEntry {
        const now = Date.now();
        const entry: CacheEntry = {
            snapshot,
            text: this.format.serialize(snapshot),
            loadedAt: now,
            mtime: now,
        };

        this.cache.set(uri.toString(), entry);
        return entry;
    }
}
