/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { bySubscription } from '@microsoft/vscode-azure-azutils';
import { Everything, type ExecuteStep, IActionContext, ICodeContext, IOutputChannel, stringifyError, Wizard } from '@microsoft/vscode-azure-utils';
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
import { DeployStaticWebAppCommandId } from '../../constants';
import { IAzureViewDataTree } from '../../services';
import type { ManagedCommand } from '../ManagedCommand';
import { staticWebAppLocationNames, type CreateStaticWebAppContext } from './CreateStaticWebAppContext';
import type { DeployStaticWebAppArgs } from './DeployStaticWebApp';
import type { StaticWebAppUnsupportedArtifactReason } from './deploymentRouting';
import { ApiLocationStep } from './steps/ApiLocationStep';
import { AppLocationStep } from './steps/AppLocationStep';
import { ConfigureStaticWebAppAzureYamlStep } from './steps/ConfigureStaticWebAppAzureYamlStep';
import { DetermineStaticWebAppDeploymentRouteStep } from './steps/DetermineStaticWebAppDeploymentRouteStep';
import { OutputLocationStep } from './steps/OutputLocationStep';
import { PickBuildPresetStep } from './steps/PickBuildPresetStep';

/**
 * Creates and optionally deploys a Static Web App through azd-generated Bicep.
 *
 * The app is created on the Free plan. Upgrading is a one-line edit to the
 * `staticWebAppSkuName` parameter of the generated Bicep followed by another
 * provision, which Azure applies to the existing app in place.
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
    public async execute(): Promise<void> {
        const get = this.container.get.bind(this.container);
        const job: AzdJob = this.ctx.code.workspace.workspaceFolders?.length ? 'deploy' : 'createNew';

        const promptSteps = [
            get(SelectIacFolderStep),
            get(HydrateAzdInfoStep),
            get(HydratableChooseSubscriptionStep),
            get(HydratableChooseLocationStep),
            get(ProjectNameStep),
            get(PickBuildPresetStep),
            get(AppLocationStep),
            get(ApiLocationStep),
            get(OutputLocationStep),
            get(ConfirmProvisionStep),
            get(DetermineStaticWebAppDeploymentRouteStep),
        ];

        const executeSteps: ExecuteStep<CreateStaticWebAppContext>[] = [
            get(IGenerateBicepStepFactory)<CreateStaticWebAppContext>(
                'staticWebApp.bicep',
                [
                    'appLocation',
                    'apiLocation',
                    'outputLocation',
                    'azdServiceName',
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
                job,
                provision: true,
                deploy: job === 'deploy',
                allowedLocationNames: staticWebAppLocationNames,
                // ConfigureStaticWebAppAzureYamlStep adds the `services:` entry,
                // so hydration shouldn't warn that it's missing.
                addsServiceEntry: true,
                resourceDisplayName: this.ctx.code.l10n.t('Static Web App'),
            },
            promptSteps,
            executeSteps,
        ).run();

        const subscriptionId = context.subscription?.subscriptionId ?? context.hydratedSubscriptionId;
        this.dataTree.invalidate(subscriptionId ? bySubscription(subscriptionId) : Everything);

        // Follow-up is deliberately *after* the wizard has already fully and
        // successfully completed (provisioning, and any direct deploy), and is
        // launched as a separate command/event so its own interactivity,
        // failure, or cancellation can never alter the create result above.
        if (context.deploymentRoute && context.iacFolder) {
            const deployArgs: DeployStaticWebAppArgs = {
                iacFolder: context.iacFolder,
                environmentName: context.environmentName,
                provider: context.deploymentRoute.provider,
                repositoryUrl: context.deploymentRoute.repositoryUrl,
                branch: context.deploymentRoute.branch,
                // deploymentRoute is only ever set once DetermineStaticWebAppDeploymentRouteStep
                // has already confirmed the artifact supports automatic deployment -- trust that
                // decision here rather than letting the launched command re-detect it, so creation
                // and this follow-up command can never disagree (e.g. in a monorepo, or when the
                // user overrode the output location away from a preset's default).
                artifactSupportsAutoDeploy: true,
            };
            this.ctx.code.commands.executeCommand(DeployStaticWebAppCommandId, deployArgs).then(undefined, (error: unknown) => {
                this.output.appendLine(this.ctx.code.l10n.t(
                    'Failed to start Static Web Apps CI/CD setup: {0}', stringifyError(error),
                ));
            });
        } else if (context.deploymentUnsupportedArtifactReason) {
            this.showUnsupportedArtifactGuidance(context.deploymentUnsupportedArtifactReason);
        }
    }

    /**
     * Shown only when the artifact shape cannot be deployed at all through
     * this extension -- neither direct `azd deploy` nor a generated
     * `azd pipeline config` workflow (which only runs `azd deploy` too) can
     * help, regardless of the Git remote. No code was deployed by any path;
     * this never claims otherwise. Wording is reason-specific so a plain
     * misconfiguration is never described as Next.js-specific, and vice versa.
     */
    private showUnsupportedArtifactGuidance(reason: StaticWebAppUnsupportedArtifactReason): void {
        const message = reason === 'hybridSsr'
            ? this.ctx.code.l10n.t(
                'This app was provisioned, but its server-rendered Next.js content cannot currently be deployed '
                + 'by this extension -- neither direct deployment nor the generated CI/CD workflow support it. '
                + 'Deploy it manually, or adjust the build to produce a supported static output.',
            )
            : this.ctx.code.l10n.t(
                'This app was provisioned, but its Static Web Apps configuration doesn\'t declare a valid deployable '
                + 'output -- direct deployment and the generated CI/CD workflow both require a build output distinct '
                + 'from the source. Check the output location (or the existing azure.yaml service), then deploy '
                + 'manually or run "Deploy Static Web App" again.',
            );
        void this.ctx.code.window.showWarningMessage(message);
    }
}
