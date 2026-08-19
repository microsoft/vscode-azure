/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { CaselessMap, Disposable, EventEmitter, InflightMap, IVsCode, stringifyError, withDelayedProgress } from '@microsoft/vscode-azure-utils';
import { inject, injectable, unmanaged } from 'inversify';
import { parseTree, printParseErrorCode } from 'jsonc-parser';
import { IAzureViewDataTree, type IAzureViewDataTree as AzureViewDataTree } from '../services';
import { isSettingsNode, type SettingsNode } from '../tree/resources/settings/SettingsNode';
import type { SettingsEntry, SettingsMap, SettingsSnapshot } from './SettingsModel';
import { SettingsUri } from './SettingsUri';

/**
 * A user-fixable problem in the settings document, carrying a source span for editor diagnostics.
 */
export class SettingsParseError extends Error {
    public constructor(
        message: string,
        /** 0-based character offset into the document text. */
        public readonly offset: number,
        /** Length of the offending span, in characters. May be 0 for a point error. */
        public readonly length: number = 0,
    ) {
        super(message);
        this.name = 'SettingsParseError';
    }
}

/** Renders settings as JSONC and parses edited document text back into settings. */
export class JsoncSettingsFormat {
    public constructor(private readonly code: IVsCode) { }

    /** Render a snapshot as document text, including the explanatory header. */
    public serialize(snapshot: SettingsSnapshot): string {
        const body = Object.fromEntries(snapshot.entries.map(entry => [entry.key, entry.value]));
        return `${this.buildHeader(snapshot)}\n${JSON.stringify(body, undefined, 4)}\n`;
    }

    /**
     * Parse document text back into settings.
     *
     * @throws {@linkcode SettingsParseError} on malformed JSON, a non-object root, duplicate keys,
     * or a non-string value.
     */
    public parse(text: string): SettingsMap {
        const errors: { error: number; offset: number; length: number }[] = [];
        const root = parseTree(text, errors, { allowTrailingComma: true, disallowComments: false });

        if (errors.length > 0) {
            const [first] = errors;
            throw new SettingsParseError(
                this.code.l10n.t('The settings file is not valid JSON: {0}.', printParseErrorCode(first.error)),
                first.offset,
                first.length,
            );
        }

        if (root?.type !== 'object') {
            throw new SettingsParseError(
                this.code.l10n.t('The settings file must contain a single JSON object of setting names and values.'),
                root?.offset ?? 0,
                root?.length ?? text.length,
            );
        }

        const entries: SettingsEntry[] = [];
        const seen = new CaselessMap<string>();

        for (const property of root.children ?? []) {
            const children = property.children ?? [];
            if (children.length < 2) {
                continue;
            }

            const [keyNode, valueNode] = children;
            const key = String(keyNode.value);
            const existing = seen.get(key);
            if (existing !== undefined) {
                throw new SettingsParseError(
                    existing === key
                        ? this.code.l10n.t('The setting \'{0}\' is listed more than once. Setting names must be unique.', key)
                        : this.code.l10n.t('The settings \'{0}\' and \'{1}\' differ only by capitalization. Azure treats setting names as case-insensitive, so only one of them would survive.', existing, key),
                    keyNode.offset,
                    keyNode.length,
                );
            }
            seen.set(key, key);

            if (valueNode.type !== 'string') {
                throw new SettingsParseError(
                    this.code.l10n.t('The value of \'{0}\' must be a quoted string. Numbers, booleans, and null are not valid setting values.', key),
                    valueNode.offset,
                    valueNode.length,
                );
            }

            entries.push({ key, value: String(valueNode.value) });
        }

        return entries;
    }

    private buildHeader(snapshot: SettingsSnapshot): string {
        const lines = [
            this.code.l10n.t('{0} for \'{1}\'.', snapshot.label, snapshot.resourceName),
        ];

        if (snapshot.writable) {
            lines.push(this.code.l10n.t('Saving this file writes these settings to Azure. Removing a setting deletes it.'));
            lines.push(this.code.l10n.t('The file is saved to Azure as-is: it overwrites any changes made elsewhere since it was opened.'));
            lines.push(this.code.l10n.t('Deployments and infrastructure-as-code tools may overwrite edits made here.'));
        } else {
            lines.push(this.code.l10n.t('These settings are read-only and cannot be edited here.'));
        }

        return lines.map(line => `// ${line}`).join('\n');
    }
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
@injectable()
export class SettingsFileSystemProvider implements vscode.FileSystemProvider, Disposable {
    private readonly changeEmitter = new EventEmitter<vscode.FileChangeEvent[]>();
    private readonly cache = new Map<string, CacheEntry>();
    private readonly pendingLoads = new InflightMap<CacheEntry>();
    private readonly freshnessWindowMs: number;
    private readonly format: JsoncSettingsFormat;

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IAzureViewDataTree) private readonly tree: AzureViewDataTree,
        @unmanaged() options?: SettingsFileSystemProviderOptions,
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
        const entry = await this.load(uri, { allowReuse: false, showProgress: false });

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
        const entry = await this.load(uri, { allowReuse: true, showProgress: true });
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
        const entry = await this.load(uri, { allowReuse: true, showProgress: false });

        if (!entry.snapshot.writable) {
            throw this.code.FileSystemError.NoPermissions(uri);
        }

        const parsed = this.format.parse(Buffer.from(content).toString('utf8'));

        const node = this.resolve(uri);
        await withDelayedProgress(
            this.code,
            {
                location: this.code.ProgressLocation.Notification,
                title: this.code.l10n.t('Saving {0} for \'{1}\'...', node.adapter.label, node.documentName),
            },
            node.adapter.write(node.owner, parsed),
        );

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
     * Resolve the settings node a URI addresses.
     *
     * @throws if the URI is malformed or its node is not currently in the tree.
     */
    private resolve(uri: vscode.Uri): SettingsNode {
        const node = this.tree.get(SettingsUri.parseNodeKey(uri));

        if (!isSettingsNode(node)) {
            throw new Error(this.code.l10n.t('These settings are no longer available. Open them again from the Azure view.'));
        }

        return node;
    }

    private async load(uri: vscode.Uri, options: { allowReuse: boolean; showProgress: boolean }): Promise<CacheEntry> {
        const key = uri.toString();
        const cached = this.cache.get(key);
        if (cached && options.allowReuse && Date.now() - cached.loadedAt < this.freshnessWindowMs) {
            return cached;
        }

        return this.pendingLoads.getOrRun(key, () => this.loadFresh(uri, options.showProgress));
    }

    private async loadFresh(uri: vscode.Uri, showProgress: boolean): Promise<CacheEntry> {
        let snapshot: SettingsSnapshot;
        try {
            const node = this.resolve(uri);
            const read = node.adapter.read(node.owner);
            snapshot = showProgress
                ? await withDelayedProgress(
                    this.code,
                    {
                        location: this.code.ProgressLocation.Notification,
                        title: this.code.l10n.t('Loading {0} for \'{1}\'...', node.adapter.label, node.documentName),
                    },
                    read,
                )
                : await read;
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
