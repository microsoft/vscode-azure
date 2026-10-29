/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Disposable, ICodeContext, relativePath } from '@microsoft/vscode-azure-utils';
import * as crypto from 'crypto';
import { inject, injectable, type ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';

/** Identifier for the {@linkcode TempDirManager} service */
export const ITempDirManager: ServiceIdentifier<ITempDirManager> = Symbol.for('ITempDirManager');
export interface ITempDirManager {
    /**
     * Creates a new temporary directory under `storageUri/tmp/`.
     * The directory is tracked for cleanup on dispose.
     */
    createTempDir(): Promise<vscode.Uri>;

    /**
     * Returns `true` when {@linkcode uri} is the `tmp/` base directory or a
     * descendant of it, i.e. a location the extension owns rather than
     * workspace content. The path is normalized first, so `..` segments cannot
     * escape the base directory.
     */
    isTempDir(uri: vscode.Uri): boolean;
}

/**
 * Manages temporary directories in the extension's storage
 * directory (`extensionContext.storageUri/tmp/`). Subdirectories
 * are cleaned up on dispose but the `tmp/` root persists across
 * sessions.
 */
@injectable()
export class TempDirManager implements ITempDirManager, Disposable {
    private readonly trackedDirs: vscode.Uri[] = [];
    private readonly baseDir: vscode.Uri;

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
    ) {
        const storageUri = this.ctx.extensionContext.storageUri ?? this.ctx.extensionContext.globalStorageUri;
        this.baseDir = this.ctx.code.Uri.joinPath(storageUri, 'tmp');
    }

    /**
     * Creates a new temporary directory under `storageUri/tmp/`.
     * The directory is tracked for cleanup on dispose.
     */
    public async createTempDir(): Promise<vscode.Uri> {
        const dirName = `d-${crypto.randomUUID().slice(0, 8)}`;
        const dir = this.ctx.code.Uri.joinPath(this.baseDir, dirName);
        await this.ctx.code.workspace.fs.createDirectory(dir);
        this.trackedDirs.push(dir);
        return dir;
    }

    /** @inheritdoc */
    public isTempDir(uri: vscode.Uri): boolean {
        const normalized = this.ctx.code.Uri.joinPath(uri, '.');
        return normalized.scheme === this.baseDir.scheme
            && normalized.authority === this.baseDir.authority
            && relativePath(this.baseDir, normalized) !== undefined;
    }

    /** @inheritdoc */
    public dispose(): void {
        for (const dir of this.trackedDirs) {
            this.ctx.code.workspace.fs.delete(dir, { recursive: true }).then(() => { /* void */ }, () => { /* ignore */ });
        }
        this.trackedDirs.length = 0;
    }
}
