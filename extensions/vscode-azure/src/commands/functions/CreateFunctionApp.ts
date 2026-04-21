/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChooseLocationStep, ChooseSubscriptionStep, ISubscriptionClientProvider } from '@microsoft/vscode-azure-azutils';
import { ICodeContext, IOutputChannel, Wizard } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzureViewDataTree, IAzureViewViewItemTree, ITempProjectManager } from '../../services';
import { AzdProvisionStep } from '../../wizard/azd/AzdProvisionStep';
import { CreateAzdEnvStep } from '../../wizard/azd/CreateAzdEnvStep';
import { EnvironmentNameStep } from '../../wizard/azd/EnvironmentNameStep';
import { GenerateAzureYamlStep } from '../../wizard/azd/GenerateAzureYamlStep';
import { GenerateBicepStep } from '../../wizard/azd/GenerateBicepStep';
import { HydrateAzdInfoStep } from '../../wizard/azd/HydrateAzdInfoStep';
import { OfferSaveStep } from '../../wizard/azd/OfferSaveStep';
import type { ManagedCommand } from '../ManagedCommand';
import type { CreateFunctionAppContext } from './CreateFunctionAppContext';
import { PickHostingPlanStep } from './steps/PickHostingPlanStep';
import { PickRuntimeStep } from './steps/PickRuntimeStep';

/**
 * Command that walks the user through creating an Azure Function App
 * using a wizard. Generates a Bicep template (with AVM modules) and
 * a stub `azure.yaml`, then optionally deploys via `azd provision`.
 */
@injectable()
export class CreateFunctionApp implements ManagedCommand {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IOutputChannel) private readonly output: IOutputChannel,
        @inject(IAzureViewDataTree) private readonly dataTree: IAzureViewDataTree,
        @inject(IAzureViewViewItemTree) private readonly viewItemTree: IAzureViewViewItemTree,
        @inject(ISubscriptionClientProvider) private readonly subscriptionClientProvider: ISubscriptionClientProvider,
        @inject(ITempProjectManager) private readonly tempManager: ITempProjectManager,
    ) { }

    /** @inheritdoc */
    public async execute(): Promise<void> {
        const wizard = new Wizard<CreateFunctionAppContext>(
            {},
            [
                new HydrateAzdInfoStep(this.ctx.code),
                new ChooseSubscriptionStep({ ...this.ctx, tree: this.viewItemTree, dataItemTree: this.dataTree }),
                new ChooseLocationStep(this.ctx, this.subscriptionClientProvider, this.output),
                new EnvironmentNameStep(this.ctx),
                new PickRuntimeStep(this.ctx),
                new PickHostingPlanStep(this.ctx),
                new OfferSaveStep(this.ctx, this.tempManager),
            ],
            [
                new GenerateBicepStep(this.ctx, 'functionApp.bicep', ['runtimeVersion', 'hostingPlan']),
                new GenerateAzureYamlStep(this.ctx.code),
                new CreateAzdEnvStep(),
                new AzdProvisionStep(this.ctx.code),
            ],
            this.output,
        );

        await wizard.run();
    }
}
