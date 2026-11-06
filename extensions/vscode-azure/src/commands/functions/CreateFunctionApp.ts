/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { bySubscription } from '@microsoft/vscode-azure-azutils';
import { dirname, ExternalError, IOutputChannel, IVsCode, Wizard, type ExecuteStep, Everything } from '@microsoft/vscode-azure-utils';
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
import { ShowEndpointUrlStep } from '../../azd/wizard/ShowEndpointUrlStep';
import { IAzureViewDataTree, IWorkspaceViewDataTree } from '../../services';
import { FunctionsProjectKeyPrefix, isFunctionsProjectNode } from '../../tree/workspace/WorkspaceNode';
import type { ManagedCommand } from '../ManagedCommand';
import type { CreateFunctionAppContext } from './CreateFunctionAppContext';
import { PickRuntimeStep } from './steps/PickRuntimeStep';
import { ConfigureFunctionAppServiceStep } from './steps/ConfigureFunctionAppServiceStep';
import { HydrateFunctionsRuntimeStep } from './steps/HydrateFunctionsRuntimeStep';

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
 *   The target may be a folder, a file inside the project, or a Functions
 *   workspace project node.
 */
@injectable()
export class CreateFunctionApp implements ManagedCommand {
    /** Capability for workspace Functions project nodes that can be deployed. */
    public static readonly DeployContextValue = 'deployFunctionApp';

    public constructor(
        @inject(IOutputChannel) private readonly output: IOutputChannel,
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IAzureViewDataTree) private readonly dataTree: IAzureViewDataTree,
        @inject(IWorkspaceViewDataTree) private readonly workspace: Pick<IWorkspaceViewDataTree, 'get'>,
        @inject(Container) private readonly container: Container,
    ) { }

    /** @inheritdoc */
    public async execute(job: AzdJob, target?: string | vscode.Uri): Promise<void> {
        const get = this.container.get.bind(this.container);

        const promptSteps = [
            get(SelectIacFolderStep),
            get(HydrateAzdInfoStep),
            get(HydratableChooseSubscriptionStep),
            get(HydratableChooseLocationStep),
            get(ProjectNameStep),
            get(HydrateFunctionsRuntimeStep),
            get(PickRuntimeStep),
            get(ConfirmProvisionStep),
        ];

        const executeSteps: ExecuteStep<CreateFunctionAppContext>[] = [
            get(IGenerateBicepStepFactory)<CreateFunctionAppContext>('functionApp', ['functionWorkerRuntime', 'runtimeVersion', 'azdServiceName']),
            get(GenerateAzureYamlStep),
            get(ConfigureFunctionAppServiceStep),
            get(CreateAzdEnvStep),
            get(AzdProvisionStep),
        ];

        if (job === 'deploy') {
            executeSteps.push(get(AzdDeployStep));
            executeSteps.push(get(ShowEndpointUrlStep));
        }

        let iacFolder: vscode.Uri | undefined;

        const resolved = this.resolveTarget(target);
        if (resolved) {
            const stat = await this.code.workspace.fs.stat(resolved);
            iacFolder = (stat.type & this.code.FileType.Directory) !== 0 ? resolved : dirname(resolved);
        }

        if (job === 'deploy' && iacFolder && iacFolder.scheme !== 'file') {
            throw new ExternalError(this.code.l10n.t('Deploying Functions requires a non-virtual workspace.'));
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

    /** Resolves a workspace Functions project node key to its project file; other targets pass through. */
    private resolveTarget(target?: string | vscode.Uri): vscode.Uri | undefined {
        if (typeof target !== 'string') {
            return target;
        }

        if (!target.startsWith(FunctionsProjectKeyPrefix)) {
            return undefined;
        }

        const project = this.workspace.get(target);
        if (!isFunctionsProjectNode(project)) {
            throw new ExternalError(this.code.l10n.t('The Functions project is not available. Refresh the workspace view.'));
        }

        return project.resourceUri;
    }
}
