/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Disposable, IExtensionContext } from '@microsoft/vscode-azure-utils';
import * as fs from 'fs/promises';
import { inject, injectable } from 'inversify';
import * as path from 'path';

/**
 * Manages generated Bicep projects in the extension's storage
 * directory (`extensionContext.storageUri/iac/`). Project
 * subdirectories are cleaned up on dispose but the `iac/` root
 * persists across sessions.
 */
@injectable()
export class TempProjectManager implements Disposable {
    private readonly projectDirs: string[] = [];
    private readonly iacBaseDir: string;

    public constructor(
        @inject(IExtensionContext) extensionContext: IExtensionContext,
    ) {
        const storageUri = extensionContext.storageUri ?? extensionContext.globalStorageUri;
        this.iacBaseDir = path.join(storageUri.fsPath, 'iac');
    }

    /**
     * Creates a new project directory under `storageUri/iac/`.
     * The directory is tracked for cleanup on dispose.
     */
    public async createProjectDir(): Promise<string> {
        await fs.mkdir(this.iacBaseDir, { recursive: true });
        const dir = await fs.mkdtemp(path.join(this.iacBaseDir, 'project-')); // TODO wrong
        this.projectDirs.push(dir);
        return dir;
    }

    public dispose(): void {
        for (const dir of this.projectDirs) {
            void fs.rm(dir, { recursive: true, force: true }).catch(() => { /* ignore */ });
        }
        this.projectDirs.length = 0;
    }
}
