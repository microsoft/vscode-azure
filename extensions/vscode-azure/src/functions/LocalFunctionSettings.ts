/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CaselessMap, ExternalError, IVsCode, readText, type ICaselessMapReader } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { findNodeAtLocation, getNodeValue } from 'jsonc-parser';
import type * as vscode from 'vscode';
import { JsoncSettingsFormat } from '../settings/SettingsFileSystemProvider';
import { editJsonc, parseJsoncObject } from '../utils/jsonc';

/** Case-insensitive plaintext local application settings; absent files have an empty value map. */
export interface LocalSettingsSnapshot {
    readonly values: ICaselessMapReader<string>;
}

/** Reads and surgically edits local Values without uploading settings or exposing them in a tree. */
@injectable()
export class LocalFunctionSettings {
    private readonly writes = new Map<string, Promise<void>>();

    public constructor(@inject(IVsCode) private readonly code: IVsCode) { }

    /** Rejects encrypted or malformed files instead of treating them as empty settings. */
    public async read(project: vscode.Uri): Promise<LocalSettingsSnapshot> {
        const text = await readText(this.code, this.code.Uri.joinPath(project, 'local.settings.json'));
        return this.parse(text ?? '{}');
    }

    /** Preserves comments, unrelated values, Host, and ConnectionStrings when editing a disable flag. */
    public async setDisabled(project: vscode.Uri, functionName: string, disabled: boolean): Promise<void> {
        await this.writeValue(project, `AzureWebJobs.${functionName}.Disabled`, String(disabled));
    }

    /** Persists a selected runtime while preserving existing key casing and unrelated project settings. */
    public async setWorkerRuntime(project: vscode.Uri, runtime: string): Promise<void> {
        await this.writeValue(project, 'FUNCTIONS_WORKER_RUNTIME', runtime);
    }

    /** Serializes read-modify-write cycles per file so concurrent edits cannot overwrite each other. */
    private writeValue(project: vscode.Uri, key: string, value: string): Promise<void> {
        const uri = this.code.Uri.joinPath(project, 'local.settings.json');
        const id = uri.toString();
        const run = (this.writes.get(id) ?? Promise.resolve()).then(() => this.writeValueNow(uri, key, value));
        const tail: Promise<void> = run.then(() => undefined, () => undefined).then(() => {
            if (this.writes.get(id) === tail) { this.writes.delete(id); }
        });
        this.writes.set(id, tail);
        return run;
    }

    private async writeValueNow(uri: vscode.Uri, key: string, value: string): Promise<void> {
        const document = this.code.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
        if (document?.isDirty) {
            throw new ExternalError(this.code.l10n.t('Save local.settings.json before editing function settings.'));
        }
        const text = await readText(this.code, uri) ?? '{}';
        const snapshot = this.parse(text);
        const existingKey = [...snapshot.values].find(([name]) => name.toLowerCase() === key.toLowerCase())?.[0] ?? key;
        const edited = editJsonc(text, ['Values', existingKey], value);
        await this.code.workspace.fs.writeFile(uri, new TextEncoder().encode(edited));
    }

    private parse(text: string): LocalSettingsSnapshot {
        const root = parseJsoncObject(this.code, text, 'local.settings.json');
        const encrypted = findNodeAtLocation(root, ['IsEncrypted']);
        if (encrypted && (encrypted.type !== 'boolean' || getNodeValue(encrypted) !== false)) {
            throw new ExternalError(this.code.l10n.t('Decrypt local.settings.json with Core Tools before reading or editing function settings.'));
        }
        const values = findNodeAtLocation(root, ['Values']);
        const entries = values
            ? new JsoncSettingsFormat(this.code).parse(text.slice(values.offset, values.offset + values.length))
            : [];
        return { values: new CaselessMap(entries.map(entry => [entry.key, entry.value])) };
    }
}
