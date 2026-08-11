/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import type { Disposable } from '../vscode/Disposable';
import { EventEmitter } from '../vscode/EventEmitter';
import type { IVsCode } from '../vscode/IVsCode';
import type { SettingsFormat } from './SettingsFormat';
import type { SettingsMap, SettingsSnapshot } from './SettingsModel';

/**
 * Supplies and persists the settings behind a settings document URI.
 *
 * This is the seam that keeps {@linkcode SettingsFileSystemProvider} free of any Azure knowledge:
 * the provider handles editor protocol (stat/read/write, read-only signalling, change events) and
 * delegates every question about *what* a URI means to the source.
 */
export interface SettingsDocumentSource {
    /**
     * Read the current settings for {@linkcode uri}.
     *
     * @throws if the URI does not name a settings collection this source can serve. The provider
     * translates such failures into `FileNotFound`.
     */
    read(uri: vscode.Uri): Promise<SettingsSnapshot>;

    /**
     * Persist {@linkcode entries} as the complete contents of the collection named by
     * {@linkcode uri}, replacing whatever is stored remotely. Keys absent from `entries` are
     * deleted.
     */
    write(uri: vscode.Uri, entries: SettingsMap): Promise<void>;
}

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
 * A {@linkcode vscode.FileSystemProvider} that presents a remote settings collection as a single
 * editable text document.
 *
 * Saving the document writes it to the backing service **as-is** -- the parsed document becomes the
 * complete new contents of the collection, so removing a key deletes that setting and a key changed
 * elsewhere since the document was opened is silently overwritten. This last-writer-wins behavior is
 * deliberate: it makes the document mean exactly what it appears to mean. The header rendered by
 * the {@linkcode SettingsFormat} states it.
 *
 * The provider is format- and service-agnostic. It knows nothing about Azure; see
 * {@linkcode SettingsDocumentSource}.
 *
 * @remarks
 * Documents exist only in memory. Nothing is written to disk unless the user explicitly saves a
 * copy, which would store the values in plain text.
 */
export class SettingsFileSystemProvider implements vscode.FileSystemProvider, Disposable {
    private readonly changeEmitter = new EventEmitter<vscode.FileChangeEvent[]>();
    private readonly cache = new Map<string, CacheEntry>();
    private readonly freshnessWindowMs: number;

    public constructor(
        private readonly code: IVsCode,
        private readonly source: SettingsDocumentSource,
        private readonly format: SettingsFormat,
        options?: SettingsFileSystemProviderOptions,
    ) {
        this.freshnessWindowMs = options?.freshnessWindowMs ?? DefaultFreshnessWindowMs;
    }

    /** @inheritdoc */
    public readonly onDidChangeFile = this.changeEmitter.event;

    /**
     * @inheritdoc
     * @remarks No-op. Settings change only through this provider or an explicit tree refresh; there
     * is nothing to subscribe to on the service side, and returning a disposable satisfies the
     * editor's contract.
     */
    public watch(): Disposable {
        return { dispose: () => { /* nothing to unwatch */ } };
    }

    /**
     * @inheritdoc
     * @throws `FileNotFound` if the source cannot resolve the URI.
     */
    public async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const entry = await this.load(uri, { allowReuse: false });

        return {
            type: this.code.FileType.File,
            ctime: entry.mtime,
            mtime: entry.mtime,
            size: Buffer.byteLength(entry.text, 'utf8'),
            // Per-file, rather than provider-wide, so a read-only collection on one resource does
            // not make every settings document read-only.
            permissions: entry.snapshot.writable ? undefined : this.code.FilePermission.Readonly,
        };
    }

    /**
     * @inheritdoc
     * @throws `FileNotFound` if the source cannot resolve the URI.
     */
    public async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const entry = await this.load(uri, { allowReuse: true });
        return Buffer.from(entry.text, 'utf8');
    }

    /**
     * @inheritdoc
     *
     * Parses the document and writes it as the collection's complete new contents.
     *
     * @throws `NoPermissions` if the collection is not writable, or the
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

        const parsed = this.format.parse(Buffer.from(content).toString('utf8'), entry.snapshot);

        await this.source.write(uri, parsed);

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

    /**
     * Drop any cached snapshot for {@linkcode uri} and notify the editor, so an open document
     * re-reads from the service. Call this when settings were changed by some other path (e.g. the
     * tree's add/edit/delete commands).
     */
    public invalidate(uri: vscode.Uri): void {
        this.cache.delete(uri.toString());
        this.changeEmitter.fire([{ type: this.code.FileChangeType.Changed, uri }]);
    }

    /** @inheritdoc */
    public dispose(): void {
        this.cache.clear();
        this.changeEmitter.dispose();
    }

    private async load(uri: vscode.Uri, options: { allowReuse: boolean }): Promise<CacheEntry> {
        const cached = this.cache.get(uri.toString());
        if (cached && options.allowReuse && Date.now() - cached.loadedAt < this.freshnessWindowMs) {
            return cached;
        }

        let snapshot: SettingsSnapshot;
        try {
            snapshot = await this.source.read(uri);
        } catch (error) {
            // The editor only acts on `FileNotFound`; anything else surfaces as an opaque failure.
            // Preserve the original message so the cause is not lost.
            throw this.code.FileSystemError.FileNotFound(
                error instanceof Error ? error.message : uri.toString(),
            );
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
