/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep } from '@microsoft/vscode-azure-utils';
import * as path from 'path';
import { FunctionAppTemplateDir } from '../../../bicep/BicepGenerator';
import type { TempProjectManager } from '../../../bicep/TempProjectManager';
import type { CreateFunctionAppContext } from '../CreateFunctionAppContext';

/**
 * Writes the generated Bicep project files to the project directory
 * (either the workspace folder or a temp directory, as chosen by
 * {@link OfferSaveStep}), then opens the main Bicep file in the
 * editor.
 */
export class WriteFilesStep extends ExecuteStep<CreateFunctionAppContext> {
    public constructor(
        private readonly extensionPath: string,
        private readonly tempManager: TempProjectManager,
    ) {
        super();
    }

    public async execute(context: CreateFunctionAppContext): Promise<void> {
        const templateDir = path.join(this.extensionPath, FunctionAppTemplateDir);

        // If OfferSaveStep already set a projectDir (workspace folder),
        // write directly there. Otherwise create a temp project dir.
        let dir = context.projectDir;
        if (!dir) {
            dir = await this.tempManager.createProjectDir();
            (context as { projectDir: string }).projectDir = dir;
        }

        await this.tempManager.writeProjectFiles(
            dir,
            templateDir,
            context.parametersContent,
            context.azureYamlContent,
        );

        await this.tempManager.openBicepFile(dir);
    }
}
