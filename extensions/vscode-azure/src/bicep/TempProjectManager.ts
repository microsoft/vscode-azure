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
    private readonly iacDir: string;

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IExtensionContext) extensionContext: IExtensionContext,
    ) {
        const storageUri = extensionContext.storageUri ?? extensionContext.globalStorageUri;
        this.iacDir = path.join(storageUri.fsPath, 'iac');
    }

    /**
     * Creates a project directory under `storageUri/iac/` structured
     * as an azd project:
     * - `infra/main.bicep` (copied from templates)
     * - `infra/main.parameters.json` (generated)
     * - `azure.yaml` (generated)
     *
     * The main Bicep template references the function-app module from
     * ACR, so no local module copy is needed.
     */
    public async writeProject(
        templateDir: string,
        parametersContent: string,
        azureYamlContent: string,
    ): Promise<string> {
        await fs.mkdir(this.iacDir, { recursive: true });
        const dir = await fs.mkdtemp(path.join(this.iacDir, 'project-'));
        this.projectDirs.push(dir);

        const infraDir = path.join(dir, 'infra');
        await fs.mkdir(infraDir);

        await Promise.all([
            fs.copyFile(path.join(templateDir, 'functionApp.bicep'), path.join(infraDir, 'main.bicep')),
            fs.writeFile(path.join(infraDir, 'main.parameters.json'), parametersContent, 'utf-8'),
            fs.writeFile(path.join(dir, 'azure.yaml'), azureYamlContent, 'utf-8'),
        ]);

        return dir;
    }

    /**
     * Copies the generated project files into the given workspace folder.
     */
    public async saveToWorkspace(
        sourceDir: string,
        targetFolder: string,
    ): Promise<void> {
        const targetInfra = path.join(targetFolder, 'infra');
        await fs.mkdir(targetInfra, { recursive: true });

        await Promise.all([
            fs.copyFile(path.join(sourceDir, 'infra', 'main.bicep'), path.join(targetInfra, 'main.bicep')),
            fs.copyFile(path.join(sourceDir, 'infra', 'main.parameters.json'), path.join(targetInfra, 'main.parameters.json')),
            fs.copyFile(path.join(sourceDir, 'azure.yaml'), path.join(targetFolder, 'azure.yaml')),
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
