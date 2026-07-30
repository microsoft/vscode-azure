/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { bySubscription } from '@microsoft/vscode-azure-azutils';
import { Everything, type ExecuteStep, IActionContext, ICodeContext, IOutputChannel, Wizard } from '@microsoft/vscode-azure-utils';
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
import { staticWebAppLocationNames, type CreateStaticWebAppContext, type CreateStaticWebAppMode } from './CreateStaticWebAppContext';
import { ApiLocationStep } from './steps/ApiLocationStep';
import { AppLocationStep } from './steps/AppLocationStep';
import { ConfigureStaticWebAppAzureYamlStep } from './steps/ConfigureStaticWebAppAzureYamlStep';
import { OutputLocationStep } from './steps/OutputLocationStep';
import { PickBuildPresetStep } from './steps/PickBuildPresetStep';
import { PickSkuStep } from './steps/PickSkuStep';

/**
 * Creates and optionally deploys a Static Web App through azd-generated Bicep.
 *
 * Basic and advanced modes share the same execution path; only advanced mode
 * prompts for plan selection.
 */
@injectable()
export class CreateStaticWebApp implements ManagedCommand {
    public constructor(
        @inject(IActionContext) private readonly actionContext: IActionContext,
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IOutputChannel) private readonly output: IOutputChannel,
        @inject(IAzureViewDataTree) private readonly dataTree: IAzureViewDataTree,
        @inject(Container) private readonly container: Container,
    ) { }

    /** @inheritdoc */
    public async execute(mode: CreateStaticWebAppMode): Promise<void> {
        const get = this.container.get.bind(this.container);
        const job: AzdJob = this.ctx.code.workspace.workspaceFolders?.length ? 'deploy' : 'createNew';
        this.actionContext.telemetry.properties.mode = mode;

        const promptSteps = [
            get(SelectIacFolderStep),
            get(HydrateAzdInfoStep),
            get(HydratableChooseSubscriptionStep),
            get(HydratableChooseLocationStep),
            get(ProjectNameStep),
            ...(mode === 'advanced' ? [get(PickSkuStep)] : []),
            get(PickBuildPresetStep),
            get(AppLocationStep),
            get(ApiLocationStep),
            get(OutputLocationStep),
            get(ConfirmProvisionStep),
        ];

        const executeSteps: ExecuteStep<CreateStaticWebAppContext>[] = [
            get(IGenerateBicepStepFactory)<CreateStaticWebAppContext>(
                'staticWebApp.bicep',
                [
                    'staticWebAppSkuName',
                    'appLocation',
                    'apiLocation',
                    'outputLocation',
                    'azdServiceName',
                    'repositoryUrl',
                    'branch',
                ],
            ),
            get(GenerateAzureYamlStep),
            get(ConfigureStaticWebAppAzureYamlStep),
            get(CreateAzdEnvStep),
            get(AzdProvisionStep),
            get(AzdDeployStep),
            get(ShowEndpointUrlStep),
        ];

        const context = await new Wizard<CreateStaticWebAppContext>(
            this.output,
            {
                mode,
                job,
                provision: true,
                deploy: job === 'deploy',
                staticWebAppSkuName: mode === 'basic' ? 'Free' : undefined,
                allowedLocationNames: staticWebAppLocationNames,
                resourceDisplayName: this.ctx.code.l10n.t('Static Web App'),
            },
            promptSteps,
            executeSteps,
        ).run();

        const subscriptionId = context.subscription?.subscriptionId ?? context.hydratedSubscriptionId;
        this.dataTree.invalidate(subscriptionId ? bySubscription(subscriptionId) : Everything);
    }
}
