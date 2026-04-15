/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Disposable, ICodeContext } from '@microsoft/vscode-azure-utils';
import * as crypto from 'crypto';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';

/**
 * Manages generated Bicep projects in the extension's storage
 * directory (`extensionContext.storageUri/iac/`). Project
 * subdirectories are cleaned up on dispose but the `iac/` root
 * persists across sessions.
 */
@injectable()
export class TempProjectManager implements Disposable {
    private readonly projectDirs: vscode.Uri[] = [];
    private readonly iacBaseDir: vscode.Uri;

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
    ) {
        const storageUri = this.ctx.extensionContext.storageUri ?? this.ctx.extensionContext.globalStorageUri;
        this.iacBaseDir = this.ctx.code.Uri.joinPath(storageUri, 'iac');
    }

    /**
     * Creates a new project directory under `storageUri/iac/`.
     * The directory is tracked for cleanup on dispose.
     */
    public async createProjectDir(): Promise<vscode.Uri> {
        const dirName = `project-${crypto.randomUUID().slice(0, 8)}`;
        const dir = this.ctx.code.Uri.joinPath(this.iacBaseDir, dirName);
        await this.ctx.code.workspace.fs.createDirectory(dir);
        this.projectDirs.push(dir);
        return dir;
    }

    public dispose(): void {
        for (const dir of this.projectDirs) {
            this.ctx.code.workspace.fs.delete(dir, { recursive: true }).then(() => { /* void */ }, () => { /* ignore */ });
        }
        this.projectDirs.length = 0;
    }
}
