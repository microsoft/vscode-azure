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
 * Copies the Bicep templates from the extension resources, writes
 * `main.parameters.json` and `azure.yaml` to a temp directory,
 * then opens the main Bicep file in the editor.
 */
export class WriteAndOpenFilesStep extends ExecuteStep<CreateFunctionAppContext> {
    public constructor(
        private readonly extensionPath: string,
        private readonly tempManager: TempProjectManager,
    ) {
        super();
    }

    public async execute(context: CreateFunctionAppContext): Promise<void> {
        const templateDir = path.join(this.extensionPath, FunctionAppTemplateDir);

        const dir = await this.tempManager.writeProject(
            templateDir,
            context.parametersContent,
            context.azureYamlContent,
        );
        (context as { projectDir: string }).projectDir = dir;

        await this.tempManager.openBicepFile(dir);
    }
}
