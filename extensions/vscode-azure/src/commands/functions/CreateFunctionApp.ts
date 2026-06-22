/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { bySubscription, ISubscriptionClientProvider } from '@microsoft/vscode-azure-azutils';
import { IActionContext, ICodeContext, IOutputChannel, Wizard, type ExecuteStep, Everything } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzdService } from '../../azd/AzdService';
import { ITempDirManager } from '../../azd/TempDirManager';
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
import { IAzureViewDataTree, IAzureViewViewItemTree } from '../../services';
import { IArmDeploymentDataProvider } from '../../tree/activity/ArmDeploymentDataProvider';
import { ICodeDeploymentDataProvider } from '../../tree/activity/CodeDeploymentDataProvider';
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
 *   {@linkcode ITempDirManager}; the workspace is never modified.
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
        @inject(ITempDirManager) private readonly tempManager: ITempDirManager,
        @inject(IAzdService) private readonly azd: IAzdService,
        @inject(IArmDeploymentDataProvider) private readonly armProvider: IArmDeploymentDataProvider,
        @inject(ICodeDeploymentDataProvider) private readonly codeProvider: ICodeDeploymentDataProvider,
    ) { }

    /** @inheritdoc */
    public async execute(job: AzdJob): Promise<void> {
        const promptSteps = [
            new SelectIacFolderStep(this.actionContext, this.ctx, this.tempManager, this.azd),
            new HydrateAzdInfoStep(this.ctx.code, this.azd),
            new HydratableChooseSubscriptionStep({ ...this.ctx, tree: this.viewItemTree, dataItemTree: this.dataTree }),
            new HydratableChooseLocationStep(this.ctx, this.subscriptionClientProvider, this.output),
            new ProjectNameStep(this.ctx),
            new PickRuntimeStep(this.ctx),
            new PickHostingPlanStep(this.ctx),
            new ConfirmProvisionStep(this.ctx),
        ];

        const executeSteps: ExecuteStep<CreateFunctionAppContext>[] = [
            new GenerateBicepStep(this.ctx, 'functionApp.bicep', ['functionWorkerRuntime', 'runtimeVersion', 'appServicePlanSkuName', 'azdServiceName']),
            new GenerateAzureYamlStep(this.azd),
            new CreateAzdEnvStep(this.azd),
            new AzdProvisionStep(this.ctx, this.azd, this.output, this.armProvider, this.tempManager),
        ];

        if (job === 'deploy') {
            executeSteps.push(new AzdDeployStep(this.actionContext, this.ctx.code, this.azd, this.codeProvider));
            executeSteps.push(new ShowEndpointUrlStep(this.ctx, this.azd));
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

        const context = await wizard.run();

        const subscriptionId = context.subscription?.subscriptionId ?? context.hydratedSubscriptionId;
        this.dataTree.invalidate(subscriptionId ? bySubscription(subscriptionId) : Everything);
    }
}
