/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FunctionAppLogicalType } from '@microsoft/vscode-azure-azutils';
import { dirname, ExternalError, ICodeContext, showMessage, showSmartQuickPick } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import { IAzdService } from '../../azd/AzdService';
import { IAzureViewDataTree, IWorkspaceViewDataTree } from '../../services';
import { AzdDeployStep } from '../../azd/wizard/AzdDeployStep';
import type { CreateFunctionAppContext } from './CreateFunctionAppContext';
import { IResourceSelector } from '../../tree/resources/ResourceSelector';
import { AzdProjectFileTag } from '../../tree/workspace/azd/AzdWorkspaceDataProvider';
import { FunctionsProjectKeyPrefix, isFunctionsProjectNode } from '../../tree/workspace/WorkspaceNode';
import { IWorkspaceIndexService } from '../../utils/workspaceIndex/WorkspaceIndexService';
import type { ManagedCommand } from '../ManagedCommand';
import { CreateFunctionApp } from './CreateFunctionApp';
import { ShowFunctionEndpointsStep } from './steps/ShowFunctionEndpointsStep';

/** Routes local deployment to the workspace wizard and remote deployment to an existing tagged azd service. */
@injectable()
export class DeployFunctionApp implements ManagedCommand {
    /** Capability shared by local projects and remote Function Apps. */
    public static readonly ContextValue = 'deployFunctionApp';

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(CreateFunctionApp) private readonly create: Pick<CreateFunctionApp, 'execute'>,
        @inject(IResourceSelector) private readonly selector: IResourceSelector,
        @inject(IWorkspaceViewDataTree) private readonly workspace: Pick<IWorkspaceViewDataTree, 'get'>,
        @inject(IWorkspaceIndexService) private readonly index: IWorkspaceIndexService,
        @inject(IAzdService) private readonly azd: IAzdService,
        @inject(AzdDeployStep) private readonly deploy: AzdDeployStep<CreateFunctionAppContext>,
        @inject(ShowFunctionEndpointsStep) private readonly endpoints: Pick<ShowFunctionEndpointsStep, 'execute'>,
        @inject(IAzureViewDataTree) private readonly dataTree: Pick<IAzureViewDataTree, 'invalidate'>,
    ) { }

    public async execute(target?: string | vscode.Uri): Promise<void> {
        if (!this.ctx.code.workspace.isTrusted || (typeof target !== 'string' && target && target.scheme !== 'file')) {
            throw new ExternalError(this.ctx.code.l10n.t('Deploying Functions requires a trusted, non-virtual workspace.'));
        }
        if (!target || typeof target !== 'string') {
            await this.create.execute('deploy', typeof target === 'string' ? undefined : target);
            return;
        }
        if (target.startsWith(FunctionsProjectKeyPrefix)) {
            const project = this.workspace.get(target);
            if (!isFunctionsProjectNode(project)) {
                throw new ExternalError(this.ctx.code.l10n.t('The Functions project is not available. Refresh the workspace view.'));
            }
            await this.create.execute('deploy', dirname(project.resourceUri));
            return;
        }
        const app = await this.selector.selectResource({ key: target, logicalTypes: [FunctionAppLogicalType] });
        const service = Object.entries(app.tags ?? {}).find(([key]) => key.toLowerCase() === 'azd-service-name')?.[1];
        const matches = service ? await this.matchingProjects(service, app.id) : [];
        if (!service || !matches.length) {
            const action = this.ctx.code.l10n.t('Deploy Workspace Project');
            const selected = await showMessage(this.ctx.code, this.ctx.code.l10n.t(
                'This Function App must have an azd-service-name tag matching a service whose current azd environment targets this app. Deploy from a workspace project instead.',
            ), { severity: 'warning' }, action);
            if (selected === action) {
                await this.create.execute('deploy');
            }
            return;
        }
        const selected = matches.length === 1 ? matches[0] : await showSmartQuickPick(this.ctx, matches, {
            placeHolder: this.ctx.code.l10n.t('Select the azd project to deploy'),
        });
        const context: CreateFunctionAppContext = {
            job: 'deploy', deploy: true, iacFolder: selected.folder, azdServiceName: service,
            subscription: app.subscription,
            resourceDisplayName: this.ctx.code.l10n.t('Function App'),
        };
        await this.deploy.execute(context, service);
        this.dataTree.invalidate(app);
        await this.endpoints.execute(context, service);
    }

    private async matchingProjects(service: string, appId: string): Promise<{ label: string; folder: vscode.Uri }[]> {
        const matches: { label: string; folder: vscode.Uri }[] = [];
        for (const uri of (await this.index.getIndex()).withTag(AzdProjectFileTag)) {
            const folder = dirname(uri);
            const show = await this.azd.show(folder);
            const targets = show?.services?.[service]?.target?.resourceIds ?? [];
            if (targets.some(id => id.toLowerCase() === appId.toLowerCase())) {
                matches.push({ label: folder.fsPath, folder });
            }
        }
        return matches;
    }
}
