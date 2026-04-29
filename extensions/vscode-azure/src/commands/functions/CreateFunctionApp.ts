/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISubscriptionClientProvider } from '@microsoft/vscode-azure-azutils';
import { getWorkspaceFolder, ICodeContext, IOutputChannel, Wizard } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzdService } from '../../azd/AzdService';
import { AzdProvisionStep } from '../../azd/wizard/AzdProvisionStep';
import type { AzdJob } from '../../azd/wizard/AzdWizardContext';
import { ConfirmProvisionStep } from '../../azd/wizard/ConfirmProvisionStep';
import { CreateAzdEnvStep } from '../../azd/wizard/CreateAzdEnvStep';
import { GenerateAzureYamlStep } from '../../azd/wizard/GenerateAzureYamlStep';
import { GenerateBicepStep } from '../../azd/wizard/GenerateBicepStep';
import { HydratableChooseLocationStep, HydratableChooseSubscriptionStep } from '../../azd/wizard/HydratableChooseSteps';
import { HydrateAzdInfoStep } from '../../azd/wizard/HydrateAzdInfoStep';
import { ProjectNameStep } from '../../azd/wizard/ProjectNameStep';
import { IAzureViewDataTree, IAzureViewViewItemTree, ITempProjectManager } from '../../services';
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
    public async execute(job: AzdJob): Promise<void> {
        if (job === 'createNew') {
            await this.runCreateNew();
        } else {
            await this.runDeploy();
        }
    }

    private async runCreateNew(): Promise<void> {
        const iacFolder = await this.tempManager.createProjectDir();
        await this.runWizard({
            job: 'createNew',
            iacFolder,
            // createNew always provisions, no need to ask.
            provision: true,
        });
    }

    private async runDeploy(): Promise<void> {
        const folder = await getWorkspaceFolder(
            this.ctx.code,
            this.ctx.code.l10n.t('Select a workspace folder to deploy as a Function App'),
        );
        if (!folder) {
            throw new Error(this.ctx.code.l10n.t('A workspace folder is required to deploy a project.'));
        }

        await this.runWizard({
            job: 'deploy',
            iacFolder: folder.uri,
            // Default to provisioning. ConfirmProvisionStep overrides this in
            // the Bootstrapped state if the user picks "No".
            provision: true,
        });
    }

    private async runWizard(seed: Partial<CreateFunctionAppContext>): Promise<void> {
        const wizard = new Wizard<CreateFunctionAppContext>(
            this.output,
            seed,
            [
                new HydrateAzdInfoStep(this.ctx.code, this.azd),
                new HydratableChooseSubscriptionStep({ ...this.ctx, tree: this.viewItemTree, dataItemTree: this.dataTree }),
                new HydratableChooseLocationStep(this.ctx, this.subscriptionClientProvider, this.output),
                new ProjectNameStep(this.ctx),
                new PickRuntimeStep(this.ctx),
                new PickHostingPlanStep(this.ctx),
                new ConfirmProvisionStep(this.ctx),
            ],
            [
                new GenerateBicepStep(this.ctx, 'functionApp.bicep', ['runtimeVersion', 'hostingPlan', 'azdServiceName']),
                new GenerateAzureYamlStep(this.azd),
                new CreateAzdEnvStep(this.azd),
                new AzdProvisionStep(this.azd),
            ],
        );

        await wizard.run();
    }
}
