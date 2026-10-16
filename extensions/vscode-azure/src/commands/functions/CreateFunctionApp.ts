/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { bySubscription } from '@microsoft/vscode-azure-azutils';
import { dirname, IOutputChannel, IVsCode, Wizard, type ExecuteStep, Everything } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';
import { Container, inject, injectable } from 'inversify';
import { AzdDeployStep } from '../../azd/wizard/AzdDeployStep';
import { AzdProvisionStep } from '../../azd/wizard/AzdProvisionStep';
import type { AzdJob } from '../../azd/wizard/AzdWizardContext';
import { ConfirmProvisionStep } from '../../azd/wizard/ConfirmProvisionStep';
import { CreateAzdEnvStep } from '../../azd/wizard/CreateAzdEnvStep';
import { GenerateAzureYamlStep } from '../../azd/wizard/GenerateAzureYamlStep';
import { IGenerateBicepStepFactory } from '../../azd/wizard/GenerateBicepStep';
import { HydratableChooseLocationStep, HydratableChooseSubscriptionStep } from '../../azd/wizard/HydratableChooseSteps';
import { HydrateAzdInfoStep } from '../../azd/wizard/HydrateAzdInfoStep';
import { ProjectNameStep } from '../../azd/wizard/ProjectNameStep';
import { SelectIacFolderStep } from '../../azd/wizard/SelectIacFolderStep';
import { IAzureViewDataTree } from '../../services';
import type { ManagedCommand } from '../ManagedCommand';
import type { CreateFunctionAppContext } from './CreateFunctionAppContext';
import { DetectFunctionRuntimeStep } from './steps/DetectFunctionRuntimeStep';
import { PickRuntimeStep } from './steps/PickRuntimeStep';
import { ShowFunctionEndpointsStep } from './steps/ShowFunctionEndpointsStep';

/**
 * Walks the user through creating an Azure Function App. Supports two
 * distinct jobs-to-be-done, selected by the {@linkcode AzdJob} argument bound
 * via the command registration's prefix args:
 *
 * - **`createNew`**: emits IaC into a temp directory managed by
 *   `ITempDirManager`; the workspace is never modified.
 * - **`deploy`**: emits IaC into the user's workspace folder so subsequent
 *   `azd deploy` / `azd provision` operate on the same project.
 *   After provisioning, also runs `azd deploy` and shows endpoint URLs.
 */
@injectable()
export class CreateFunctionApp implements ManagedCommand {
    public constructor(
        @inject(IOutputChannel) private readonly output: IOutputChannel,
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IAzureViewDataTree) private readonly dataTree: IAzureViewDataTree,
        @inject(Container) private readonly container: Container,
    ) { }

    /** @inheritdoc */
    public async execute(job: AzdJob, target?: vscode.Uri): Promise<void> {
        const get = this.container.get.bind(this.container);

        const promptSteps = [
            get(SelectIacFolderStep),
            get(HydrateAzdInfoStep),
            get(DetectFunctionRuntimeStep),
            get(HydratableChooseSubscriptionStep),
            get(HydratableChooseLocationStep),
            get(ProjectNameStep),
            get(PickRuntimeStep),
            get(ConfirmProvisionStep),
        ];

        const executeSteps: ExecuteStep<CreateFunctionAppContext>[] = [
            get(IGenerateBicepStepFactory)<CreateFunctionAppContext>('functionApp', ['functionWorkerRuntime', 'runtimeVersion', 'azdServiceName']),
            get(GenerateAzureYamlStep),
            get(CreateAzdEnvStep),
            get(AzdProvisionStep),
        ];

        if (job === 'deploy') {
            executeSteps.push(get(AzdDeployStep));
            executeSteps.push(get(ShowFunctionEndpointsStep));
        }

        let iacFolder: vscode.Uri | undefined;
        if (target) {
            const stat = await this.code.workspace.fs.stat(target);
            iacFolder = stat.type === this.code.FileType.Directory ? target : dirname(target);
        }
        const wizard = new Wizard<CreateFunctionAppContext>(
            this.output,
            {
                job,
                iacFolder,
                resourceDisplayName: this.code.l10n.t('Function App'),
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
