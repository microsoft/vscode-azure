/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeContext, Wizard } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { TempProjectManager } from '../../bicep/TempProjectManager';
import { IAzureViewDataTree } from '../../services';
import type { ManagedCommand } from '../ManagedCommand';
import type { CreateFunctionAppContext } from './CreateFunctionAppContext';
import { DeployStep } from './steps/DeployStep';
import { GenerateAzureYamlStep } from './steps/GenerateAzureYamlStep';
import { GenerateBicepStep } from './steps/GenerateBicepStep';
import { InputFunctionAppNameStep } from './steps/InputFunctionAppNameStep';
import { OfferSaveStep } from './steps/OfferSaveStep';
import { PickHostingPlanStep } from './steps/PickHostingPlanStep';
import { PickResourceGroupStep } from './steps/PickResourceGroupStep';
import { PickRuntimeStep } from './steps/PickRuntimeStep';
import { SaveToWorkspaceStep } from './steps/SaveToWorkspaceStep';
import { WriteAndOpenFilesStep } from './steps/WriteAndOpenFilesStep';

/**
 * Command that walks the user through creating an Azure Function App
 * using a wizard. Generates a Bicep template (with AVM modules) and
 * a stub `azure.yaml`, then optionally deploys via `azd provision`.
 */
@injectable()
export class CreateFunctionApp implements ManagedCommand {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IAzureViewDataTree) private readonly dataTree: IAzureViewDataTree,
        @inject(TempProjectManager) private readonly tempManager: TempProjectManager,
    ) { }

    public async execute(): Promise<void> {
        const wizard = new Wizard<CreateFunctionAppContext>(
            {} as CreateFunctionAppContext,
            [
                new PickResourceGroupStep(this.ctx, this.dataTree),
                new InputFunctionAppNameStep(this.ctx),
                new PickRuntimeStep(this.ctx),
                new PickHostingPlanStep(this.ctx),
                new OfferSaveStep(this.ctx),
            ],
            [
                new GenerateBicepStep(),
                new GenerateAzureYamlStep(),
                new WriteAndOpenFilesStep(this.ctx.extensionContext.extensionPath, this.tempManager),
                new SaveToWorkspaceStep(this.ctx.code, this.tempManager),
                new DeployStep(this.ctx.code),
            ],
        );

        await wizard.run();
    }
}
