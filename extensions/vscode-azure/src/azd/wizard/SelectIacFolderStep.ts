/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getWorkspaceFolder, IActionContext, ICodeContext, PromptStep, showSmartQuickPick } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import { IAzdService } from '../AzdService';
import { ITempDirManager } from '../TempDirManager';
import type { AzdWizardContext } from './AzdWizardContext';

/**
 * Picks the {@linkcode AzdWizardContext.iacFolder iacFolder} based on
 * {@linkcode AzdWizardContext.job job}:
 *
 * - `createNew`: allocates a temp directory via {@linkcode ITempDirManager}.
 *   The workspace is never touched.
 * - `deploy`: prompts the user to pick a workspace folder (silent in
 *   single-root workspaces, shows a picker in multi-root). Dismissing the
 *   picker bubbles up as a {@linkcode CancellationError} from
 *   {@linkcode getWorkspaceFolder}; an empty workspace throws an explanatory
 *   error since the deploy job has nothing to write IaC into.
 * - No job (e.g. `AzdUp`): scans workspace folders for an existing
 *   `azure.yaml` or `azure.yml` via
 *   {@linkcode IAzdService.findAzureYaml findAzureYaml}. Requires
 *   {@linkcode azd} to be provided. Throws if neither file is found;
 *   auto-selects the single match or prompts when multiple workspace
 *   folders contain one.
 *
 * Skipped when {@linkcode AzdWizardContext.iacFolder iacFolder} is already
 * set (e.g. when invoked from a right-click on `azure.yaml`).
 */
@injectable()
export class SelectIacFolderStep<TContext extends AzdWizardContext> extends PromptStep<TContext> {
    public constructor(
        @inject(IActionContext) private readonly actionContext: IActionContext,
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(ITempDirManager) private readonly tempManager: ITempDirManager,
        @inject(IAzdService) private readonly azd: IAzdService,
    ) {
        super();
    }

    public override shouldPrompt(context: Readonly<TContext>): boolean {
        return !context.iacFolder;
    }

    public async prompt(context: Readonly<TContext>): Promise<Partial<TContext>> {
        if (context.job === 'createNew') {
            const iacFolder = await this.tempManager.createTempDir();
            return { iacFolder } as Partial<TContext>;
        }

        if (context.job === 'deploy') {
            return this.promptDeployFolder(context);
        }

        // No job -- scan workspace folders for azure.yaml
        return this.promptAzureYamlFolder();
    }

    private async promptDeployFolder(context: Readonly<TContext>): Promise<Partial<TContext>> {
        const resourceDisplayName = context.resourceDisplayName ?? this.ctx.code.l10n.t('Function App');
        const folder = await getWorkspaceFolder(
            this.ctx.code,
            this.ctx.code.l10n.t('Select a workspace folder to deploy as a {0}', resourceDisplayName),
        );
        if (!folder) {
            this.actionContext.errorHandling.suppress = 'reportIssue';
            throw new Error(this.ctx.code.l10n.t('Open a folder in VS Code to deploy a project as a {0}.', resourceDisplayName));
        }
        return { iacFolder: folder.uri } as Partial<TContext>;
    }

    private async promptAzureYamlFolder(): Promise<Partial<TContext>> {
        const workspaceFolders = this.ctx.code.workspace.workspaceFolders;
        if (!workspaceFolders?.length) {
            this.actionContext.errorHandling.suppress = 'reportIssue';
            throw new Error(this.ctx.code.l10n.t('No workspace folder is open. Open a folder with an azure.yaml file.'));
        }

        const candidates: { label: string; uri: vscode.Uri }[] = [];
        for (const folder of workspaceFolders) {
            if ((await this.azd.findAzureYaml(folder.uri)).length) {
                candidates.push({ label: folder.name, uri: folder.uri });
            }
        }

        if (candidates.length === 0) {
            this.actionContext.errorHandling.suppress = 'reportIssue';
            throw new Error(this.ctx.code.l10n.t('No azure.yaml file found in the workspace.'));
        }

        if (candidates.length === 1) {
            return { iacFolder: candidates[0].uri } as Partial<TContext>;
        }

        const picked = await showSmartQuickPick(this.ctx,
            candidates.map(c => ({ label: c.label, uri: c.uri })),
            { placeHolder: this.ctx.code.l10n.t('Select a project to provision and deploy') },
        );
        return { iacFolder: picked.uri } as Partial<TContext>;
    }
}
