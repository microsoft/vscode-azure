/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Disposable, IExtensionContext, IVsCode } from '@microsoft/vscode-azure-utils';
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
        @inject(IVsCode) private readonly code: IVsCode,
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
        const dir = await fs.mkdtemp(path.join(this.iacBaseDir, 'project-'));
        this.projectDirs.push(dir);
        return dir;
    }

    /**
     * Writes the Bicep project files into the given directory:
     * - `infra/main.bicep` (copied from templates)
     * - `infra/main.parameters.json` (generated)
     * - `azure.yaml` (generated)
     *
     * The target directory can be either a temp dir from
     * {@linkcode createProjectDir} or a workspace folder.
     */
    public async writeProjectFiles(
        targetDir: string,
        templateDir: string,
        parametersContent: string,
        azureYamlContent: string,
    ): Promise<void> {
        const infraDir = path.join(targetDir, 'infra');
        await fs.mkdir(infraDir, { recursive: true });

        await Promise.all([
            fs.copyFile(path.join(templateDir, 'functionApp.bicep'), path.join(infraDir, 'main.bicep')),
            fs.writeFile(path.join(infraDir, 'main.parameters.json'), parametersContent, 'utf-8'),
            fs.writeFile(path.join(targetDir, 'azure.yaml'), azureYamlContent, 'utf-8'),
        ]);
    }

    /**
     * Opens the generated main Bicep file in a VS Code editor tab.
     */
    public async openBicepFile(dir: string): Promise<void> {
        const bicepPath = path.join(dir, 'infra', 'main.bicep');
        const doc = await this.code.workspace.openTextDocument(
            this.code.Uri.file(bicepPath),
        );
        await this.code.window.showTextDocument(doc);
    }

    public dispose(): void {
        for (const dir of this.projectDirs) {
            void fs.rm(dir, { recursive: true, force: true }).catch(() => { /* ignore */ });
        }
        this.projectDirs.length = 0;
    }
}
