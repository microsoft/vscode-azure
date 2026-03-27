/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChooseLocationStep, ISubscriptionClientProvider } from '@microsoft/vscode-azure-azutils';
import { ICodeContext, Wizard } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { TempProjectManager } from '../../bicep/TempProjectManager';
import { IAzureViewDataTree, IAzureViewViewItemTree } from '../../services';
import type { ManagedCommand } from '../ManagedCommand';
import type { CreateFunctionAppContext } from './CreateFunctionAppContext';
import { DeployStep } from './steps/DeployStep';
import { GenerateAzureYamlStep } from './steps/GenerateAzureYamlStep';
import { GenerateBicepStep } from './steps/GenerateBicepStep';
import { InputEnvironmentNameStep } from './steps/InputEnvironmentNameStep';
import { InputFunctionAppNameStep } from './steps/InputFunctionAppNameStep';
import { OfferSaveStep } from './steps/OfferSaveStep';
import { PickHostingPlanStep } from './steps/PickHostingPlanStep';
import { PickRuntimeStep } from './steps/PickRuntimeStep';
import { PickSubscriptionStep } from './steps/PickSubscriptionStep';
import { WriteFilesStep } from './steps/WriteFilesStep';

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
        @inject(IAzureViewViewItemTree) private readonly viewItemTree: IAzureViewViewItemTree,
        @inject(ISubscriptionClientProvider) private readonly subscriptionClientProvider: ISubscriptionClientProvider,
        @inject(TempProjectManager) private readonly tempManager: TempProjectManager,
    ) { }

    public async execute(): Promise<void> {
        const wizard = new Wizard<CreateFunctionAppContext>(
            {} as CreateFunctionAppContext,
            [
                new PickSubscriptionStep(this.ctx, this.dataTree, this.viewItemTree),
                new ChooseLocationStep(this.ctx, this.subscriptionClientProvider),
                new InputEnvironmentNameStep(this.ctx),
                new InputFunctionAppNameStep(this.ctx),
                new PickRuntimeStep(this.ctx),
                new PickHostingPlanStep(this.ctx),
                new OfferSaveStep(this.ctx),
            ],
            [
                new GenerateBicepStep(),
                new GenerateAzureYamlStep(),
                new WriteFilesStep(this.ctx.extensionContext.extensionPath, this.tempManager),
                new DeployStep(this.ctx.code),
            ],
        );

        await wizard.run();
    }
}
