/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { bySubscription } from '@microsoft/vscode-azure-azutils';
import { IOutputChannel, IVsCode, Wizard, type ExecuteStep, Everything } from '@microsoft/vscode-azure-utils';
import { Container, inject, injectable } from 'inversify';
import { AzdProvisionStep } from '../../azd/wizard/AzdProvisionStep';
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
import { PickRuntimeStep } from './steps/PickRuntimeStep';

/**
 * Walks the user through creating an Azure Function App. IaC is emitted into a temp directory
 * managed by `ITempDirManager`; the workspace is never modified.
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
    public async execute(): Promise<void> {
        const get = this.container.get.bind(this.container);

        const promptSteps = [
            get(SelectIacFolderStep),
            get(HydrateAzdInfoStep),
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

        const wizard = new Wizard<CreateFunctionAppContext>(
            this.output,
            {
                job: 'createNew',
                resourceDisplayName: this.code.l10n.t('Function App'),
                provision: true, // Provisioning is assumed unless an environment exists, in which case the user will be prompted to confirm
                deploy: false,
            },
            promptSteps,
            executeSteps,
        );

        const context = await wizard.run();

        const subscriptionId = context.subscription?.subscriptionId ?? context.hydratedSubscriptionId;
        this.dataTree.invalidate(subscriptionId ? bySubscription(subscriptionId) : Everything);
    }
}
