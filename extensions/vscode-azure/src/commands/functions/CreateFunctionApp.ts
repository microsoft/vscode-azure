/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import { ISubscriptionClientProvider } from '@microsoft/vscode-azure-azutils';
import { IActionContext, ICodeContext, IOutputChannel, Wizard, type ExecuteStep } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzdService } from '../../azd/AzdService';
import { AzdDeployStep } from '../../azd/wizard/AzdDeployStep';
import { AzdProvisionStep } from '../../azd/wizard/AzdProvisionStep';
import type { AzdJob } from '../../azd/wizard/AzdWizardContext';
import { ConfirmProvisionStep } from '../../azd/wizard/ConfirmProvisionStep';
import { CreateAzdEnvStep } from '../../azd/wizard/CreateAzdEnvStep';
import { GenerateAzureYamlStep } from '../../azd/wizard/GenerateAzureYamlStep';
import { GenerateBicepStep } from '../../azd/wizard/GenerateBicepStep';
import { HydratableChooseLocationStep, HydratableChooseSubscriptionStep } from '../../azd/wizard/HydratableChooseSteps';
import { HydrateAzdInfoStep } from '../../azd/wizard/HydrateAzdInfoStep';
import { ProjectNameStep } from '../../azd/wizard/ProjectNameStep';
import { SelectIacFolderStep } from '../../azd/wizard/SelectIacFolderStep';
import { ShowEndpointUrlStep } from '../../azd/wizard/ShowEndpointUrlStep';
import { IAzureSubscriptionProvider, IAzureViewDataTree, IAzureViewViewItemTree, ITempProjectManager } from '../../services';
import { ArmDeploymentDataProvider } from '../../tree/activity/ArmDeploymentDataProvider';
import { CodeDeploymentDataProvider } from '../../tree/activity/CodeDeploymentDataProvider';
import type { ManagedCommand } from '../ManagedCommand';
import type { CreateFunctionAppContext } from './CreateFunctionAppContext';
import { PickHostingPlanStep } from './steps/PickHostingPlanStep';
import { PickRuntimeStep } from './steps/PickRuntimeStep';

/**
 * Walks the user through creating an Azure Function App. Supports two
 * distinct jobs-to-be-done, selected by the {@linkcode AzdJob} argument bound
 * via the command registration's prefix args:
 *
 * - **`createNew`**: emits IaC into a temp directory managed by
 *   {@linkcode ITempProjectManager}; the workspace is never modified.
 * - **`deploy`**: emits IaC into the user's workspace folder so subsequent
 *   `azd deploy` / `azd provision` operate on the same project.
 *   After provisioning, also runs `azd deploy` and shows endpoint URLs.
 */
@injectable()
export class CreateFunctionApp implements ManagedCommand {
    public constructor(
        @inject(IActionContext) private readonly actionContext: IActionContext,
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IOutputChannel) private readonly output: IOutputChannel,
        @inject(IAzureViewDataTree) private readonly dataTree: IAzureViewDataTree,
        @inject(IAzureViewViewItemTree) private readonly viewItemTree: IAzureViewViewItemTree,
        @inject(ISubscriptionClientProvider) private readonly subscriptionClientProvider: ISubscriptionClientProvider,
        @inject(ITempProjectManager) private readonly tempManager: ITempProjectManager,
        @inject(IAzdService) private readonly azd: IAzdService,
        @inject(ArmDeploymentDataProvider) private readonly armProvider: ArmDeploymentDataProvider,
        @inject(CodeDeploymentDataProvider) private readonly codeProvider: CodeDeploymentDataProvider,
        @inject(IAzureSubscriptionProvider) private readonly subscriptionProvider: AzureSubscriptionProvider,
    ) { }

    /** @inheritdoc */
    public async execute(job: AzdJob): Promise<void> {
        const promptSteps = [
            new SelectIacFolderStep(this.ctx, this.tempManager),
            new HydrateAzdInfoStep(this.ctx.code, this.azd),
            new HydratableChooseSubscriptionStep({ ...this.ctx, tree: this.viewItemTree, dataItemTree: this.dataTree }),
            new HydratableChooseLocationStep(this.ctx, this.subscriptionClientProvider, this.output),
            new ProjectNameStep(this.ctx),
            new PickRuntimeStep(this.ctx),
            new PickHostingPlanStep(this.ctx),
            new ConfirmProvisionStep(this.ctx),
        ];

        const executeSteps: ExecuteStep<CreateFunctionAppContext>[] = [
            new GenerateBicepStep(this.ctx, 'functionApp.bicep', ['runtimeVersion', 'hostingPlan', 'azdServiceName']),
            new GenerateAzureYamlStep(this.azd),
            new CreateAzdEnvStep(this.azd),
            new AzdProvisionStep(this.azd, this.output, this.armProvider, this.subscriptionProvider),
        ];

        if (job === 'deploy') {
            executeSteps.push(new AzdDeployStep(this.actionContext, this.azd, this.output, this.codeProvider));
            executeSteps.push(new ShowEndpointUrlStep(this.ctx));
        }

        const wizard = new Wizard<CreateFunctionAppContext>(
            this.output,
            {
                job,
                provision: true, // Provisioning is assumed unless an environment exists, in which case the user will be prompted to confirm
                deploy: job === 'deploy', // Only deploy if the deploy job is selected
            },
            promptSteps,
            executeSteps,
        );

        await wizard.run();
    }
}
