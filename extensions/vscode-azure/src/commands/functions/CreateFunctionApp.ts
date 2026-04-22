/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChooseLocationStep, ChooseSubscriptionStep, ISubscriptionClientProvider } from '@microsoft/vscode-azure-azutils';
import { ICodeContext, IOutputChannel, Wizard } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzdService } from '../../azd/AzdService';
import { AzdProvisionStep } from '../../azd/wizard/AzdProvisionStep';
import { CreateAzdEnvStep } from '../../azd/wizard/CreateAzdEnvStep';
import { EnvironmentNameStep } from '../../azd/wizard/EnvironmentNameStep';
import { GenerateAzureYamlStep } from '../../azd/wizard/GenerateAzureYamlStep';
import { GenerateBicepStep } from '../../azd/wizard/GenerateBicepStep';
import { HydrateAzdInfoStep } from '../../azd/wizard/HydrateAzdInfoStep';
import { OfferSaveStep } from '../../azd/wizard/OfferSaveStep';
import { IAzureViewDataTree, IAzureViewViewItemTree, ITempProjectManager } from '../../services';
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
        @inject(IAzdService) private readonly azd: IAzdService,
    ) { }

    /** @inheritdoc */
    public async execute(): Promise<void> {
        const wizard = new Wizard<CreateFunctionAppContext>(
            this.output,
            {},
            [
                new HydrateAzdInfoStep(this.ctx.code, this.azd),
                new ChooseSubscriptionStep({ ...this.ctx, tree: this.viewItemTree, dataItemTree: this.dataTree }),
                new ChooseLocationStep(this.ctx, this.subscriptionClientProvider, this.output),
                new EnvironmentNameStep(this.ctx),
                new PickRuntimeStep(this.ctx),
                new PickHostingPlanStep(this.ctx),
                new OfferSaveStep(this.ctx, this.tempManager),
            ],
            [
                new GenerateBicepStep(this.ctx, 'functionApp.bicep', ['runtimeVersion', 'hostingPlan']),
                new GenerateAzureYamlStep(this.azd),
                new CreateAzdEnvStep(this.azd),
                new AzdProvisionStep(this.azd),
            ],
        );

        await wizard.run();
    }
}
