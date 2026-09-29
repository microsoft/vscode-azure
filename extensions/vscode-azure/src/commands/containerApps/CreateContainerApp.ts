/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { bySubscription } from '@microsoft/vscode-azure-azutils';
import { Everything, IOutputChannel, IVsCode, Wizard, type ExecuteStep } from '@microsoft/vscode-azure-utils';
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
import { ShowEndpointUrlStep } from '../../azd/wizard/ShowEndpointUrlStep';
import { IAzureViewDataTree } from '../../services';
import type { ManagedCommand } from '../ManagedCommand';
import type { CreateContainerAppContext } from './CreateContainerAppContext';
import { ConfigureContainerAppServiceStep } from './steps/ConfigureContainerAppServiceStep';
import { DetectTargetPortStep } from './steps/DetectTargetPortStep';
import { VerifyContainerAppStartStep } from './steps/VerifyContainerAppStartStep';

/**
 * Walks the user through creating an Azure Container App. Supports two
 * distinct jobs-to-be-done, selected by the {@linkcode AzdJob} argument bound
 * via the command registration's prefix args:
 *
 * - **`createNew`**: emits IaC into a temp directory managed by
 *   `ITempDirManager` and provisions the quickstart image; the workspace is never modified.
 * - **`deploy`**: emits IaC into the user's workspace folder so subsequent
 *   `azd deploy` / `azd provision` operate on the same project.
 *   After provisioning, also runs `azd deploy` and shows endpoint URLs.
 *
 * The managed environment, registry, Log Analytics workspace, and app identity
 * are provisioned as supporting infrastructure by the Bicep topology, so none of
 * them has a command or a prompt of its own.
 */
@injectable()
export class CreateContainerApp implements ManagedCommand {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IOutputChannel) private readonly output: IOutputChannel,
        @inject(IAzureViewDataTree) private readonly dataTree: IAzureViewDataTree,
        @inject(Container) private readonly container: Container,
    ) { }

    /** @inheritdoc */
    public async execute(job: AzdJob): Promise<void> {
        const get = this.container.get.bind(this.container);

        const promptSteps = [
            get(SelectIacFolderStep),
            get(HydrateAzdInfoStep),
            get(HydratableChooseSubscriptionStep),
            get(HydratableChooseLocationStep),
            get(ProjectNameStep),
            get(DetectTargetPortStep),
            get(ConfirmProvisionStep),
        ];

        const executeSteps: ExecuteStep<CreateContainerAppContext>[] = [
            get(IGenerateBicepStepFactory)<CreateContainerAppContext>('containerApp', [
                'targetPort', 'azdServiceName', 'containerAppName',
            ]),
            get(GenerateAzureYamlStep),
            get(ConfigureContainerAppServiceStep),
            get(CreateAzdEnvStep),
            get(AzdProvisionStep),
            get(AzdDeployStep),
            get(VerifyContainerAppStartStep),
            get(ShowEndpointUrlStep),
        ];

        const wizard = new Wizard<CreateContainerAppContext>(
            this.output,
            {
                job,
                resourceDisplayName: this.code.l10n.t('Container App'),
                containerAppName: '${AZURE_CONTAINER_APP_NAME}', // eslint-disable-line no-template-curly-in-string -- resolved by azd on every provision
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
