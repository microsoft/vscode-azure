/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    IVsCode, LocalSettingsFile,
    type SettingsDocumentSource, type SettingsMap, type SettingsSnapshot,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';

/** URI scheme under which the *local* side of a settings comparison is served. */
export const LocalSettingsScheme = 'azure-settings-local';

/**
 * Projects a local settings file into the same JSONC shape as a remote settings document.
 *
 * This exists so that "compare with local" can be a plain side-by-side diff. A raw diff of
 * `local.settings.json` against the remote document would be unreadable -- one side is wrapped in a
 * `Values` object next to unrelated keys, the other is a flat map -- so both sides are projected
 * through the same format and the diff shows only what actually differs: the settings.
 *
 * Saving the local side writes back through {@linkcode LocalSettingsFile}, which rewrites only the
 * settings and leaves the rest of the file untouched.
 */
@injectable()
export class LocalSettingsDocumentSource implements SettingsDocumentSource {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
    ) { }

    /**
     * Build the URI that serves {@linkcode fileUri} as a settings document.
     *
     * The local file's own path is carried verbatim, so the document is self-describing and
     * survives a window reload just as the remote side does.
     */
    public toDocumentUri(fileUri: vscode.Uri, collectionLabel: string): vscode.Uri {
        return this.code.Uri.from({
            scheme: LocalSettingsScheme,
            path: fileUri.path,
            query: new URLSearchParams({ label: collectionLabel, file: fileUri.toString() }).toString(),
        });
    }

    /** @inheritdoc */
    public async read(uri: vscode.Uri): Promise<SettingsSnapshot> {
        const { fileUri, label } = this.parse(uri);
        const file = new LocalSettingsFile(basename(fileUri.path));

        return {
            entries: file.parse(await this.readContents(fileUri)),
            resourceName: basename(fileUri.path),
            collectionLabel: label,
            valuesReadable: true,
            writable: true,
            structured: false,
        };
    }

    /** @inheritdoc */
    public async write(uri: vscode.Uri, entries: SettingsMap): Promise<void> {
        const { fileUri } = this.parse(uri);
        const file = new LocalSettingsFile(basename(fileUri.path));

        const contents = file.serialize(entries, await this.readContents(fileUri));
        await this.code.workspace.fs.writeFile(fileUri, Buffer.from(contents, 'utf8'));
    }

    /** Contents of the file, or `''` when it does not exist yet. */
    private async readContents(fileUri: vscode.Uri): Promise<string> {
        try {
            return Buffer.from(await this.code.workspace.fs.readFile(fileUri)).toString('utf8');
        } catch {
            // A missing local file is a normal state -- it is exactly what "download" creates.
            return '';
        }
    }

    private parse(uri: vscode.Uri): { fileUri: vscode.Uri; label: string } {
        const query = new URLSearchParams(uri.query);
        const file = query.get('file');
        if (!file) {
            throw new Error(`Not a local settings URI: '${uri.toString()}' does not name a file`);
        }

        return { fileUri: this.code.Uri.parse(file), label: query.get('label') ?? '' };
    }
}

function basename(path: string): string {
    const segments = path.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? path;
}
