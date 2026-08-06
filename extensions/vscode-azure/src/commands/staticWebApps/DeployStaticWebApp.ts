/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, ICodeContext } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import { parse } from 'yaml';
import { IAzdService, MinAzdPipelineVersion } from '../../azd/AzdService';
import { ActivityTreeViewId } from '../../constants';
import { IGitRemoteService, type GitRemoteProvider } from '../../staticWebApps/GitRemoteService';
import { ICodeDeploymentDataProvider } from '../../tree/activity/CodeDeploymentDataProvider';
import type { ManagedCommand } from '../ManagedCommand';
import { detectStaticWebAppProject } from './steps/frameworkDetection';

/**
 * Known-good context for {@linkcode DeployStaticWebApp}, supplied by a caller
 * (e.g. `CreateStaticWebApp`, immediately after a successful create) that has
 * already resolved the project and its Git remote. When supplied, the
 * command skips workspace-wide rediscovery entirely.
 */
export interface DeployStaticWebAppArgs {
    readonly iacFolder: vscode.Uri;
    readonly environmentName?: string;
    /** Known CI/CD-eligible provider. Omit to force fresh remote resolution. */
    readonly provider?: 'github' | 'azdo';
    readonly repositoryUrl?: string;
    readonly branch?: string;
}

const githubWorkflowPaths = ['.github/workflows/azure-dev.yml', '.github/workflows/azure-dev.yaml'];
const azdoWorkflowPaths = [
    '.azdo/pipelines/azure-dev.yml',
    '.azdo/pipelines/azure-dev.yaml',
    '.azuredevops/pipelines/azure-dev.yml',
    '.azuredevops/pipelines/azure-dev.yaml',
];

/**
 * Standalone, repeatable Static Web Apps deployment router.
 *
 * Chooses between direct deployment (`azd deploy`, unmodified) and CI/CD
 * setup (`azd pipeline config`) based solely on the project's existing Git
 * remote -- never assists with initializing, adding, or pushing one.
 *
 * Invocable two ways:
 * - With {@linkcode DeployStaticWebAppArgs} (e.g. launched by
 *   `CreateStaticWebApp` right after a successful create): skips discovery
 *   entirely and uses the caller's already-resolved context.
 * - From the command palette (no args): resolves the target project itself,
 *   prompting with a {@linkcode vscode.QuickPick} when more than one
 *   Static Web Apps project is open.
 */
@injectable()
export class DeployStaticWebApp implements ManagedCommand {
    public constructor(
        @inject(IActionContext) private readonly actionContext: IActionContext,
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IAzdService) private readonly azd: IAzdService,
        @inject(IGitRemoteService) private readonly gitRemote: IGitRemoteService,
        @inject(ICodeDeploymentDataProvider) private readonly codeProvider: ICodeDeploymentDataProvider,
    ) { }

    /** @inheritdoc */
    public async execute(args?: DeployStaticWebAppArgs): Promise<void> {
        const resolved = args ? { iacFolder: args.iacFolder, environmentName: args.environmentName } : await this.resolveProject();
        if (!resolved) {
            return;
        }
        const { iacFolder, environmentName } = resolved;

        let provider: GitRemoteProvider | undefined = args?.provider;
        let hasUpstream = !!args;

        if (!args) {
            const remote = await this.gitRemote.getRemoteInfo(iacFolder);
            provider = remote?.provider;
            hasUpstream = !!remote?.hasUpstream;
        }

        this.actionContext.telemetry.properties.remoteProvider = provider ?? 'none';

        if (!provider || provider === 'unsupported') {
            this.actionContext.telemetry.properties.deploymentRoute = 'direct';
            await this.directDeploy(iacFolder);
            return;
        }

        const providerLabel = provider === 'github' ? this.ctx.code.l10n.t('GitHub Actions') : this.ctx.code.l10n.t('Azure Pipelines');
        const deployDirectlyLabel = this.ctx.code.l10n.t('Deploy Directly Instead');

        if (!hasUpstream) {
            this.actionContext.telemetry.properties.deploymentRoute = 'blockedNotPushed';
            const selection = await this.ctx.code.window.showWarningMessage(
                this.ctx.code.l10n.t(
                    'The current branch must be pushed before {0} can be configured.',
                    providerLabel,
                ),
                deployDirectlyLabel,
            );
            if (selection === deployDirectlyLabel) {
                await this.directDeploy(iacFolder);
            }
            return;
        }

        if (!await this.azd.checkVersion(MinAzdPipelineVersion)) {
            this.actionContext.telemetry.properties.deploymentRoute = 'blockedAzdVersion';
            const selection = await this.ctx.code.window.showWarningMessage(
                this.ctx.code.l10n.t(
                    'Azure Developer CLI (azd) version {0} or later is required to configure {1}.',
                    MinAzdPipelineVersion,
                    providerLabel,
                ),
                deployDirectlyLabel,
            );
            if (selection === deployDirectlyLabel) {
                await this.directDeploy(iacFolder);
            }
            return;
        }

        if (!await this.confirmProviderSwitch(iacFolder, provider)) {
            this.actionContext.telemetry.properties.deploymentRoute = 'cancelledProviderSwitch';
            return;
        }

        this.actionContext.telemetry.properties.deploymentRoute = 'cicd';
        await this.configureCicd(iacFolder, provider, environmentName);
    }

    /**
     * Resolves the target project when invoked without
     * {@linkcode DeployStaticWebAppArgs} (command palette). Enumerates open
     * workspace folders for an azd project with a `host: staticwebapp`
     * service; prompts with a {@linkcode vscode.QuickPick} when more than
     * one matches.
     */
    private async resolveProject(): Promise<{ readonly iacFolder: vscode.Uri; readonly environmentName?: string } | undefined> {
        const folders = this.ctx.code.workspace.workspaceFolders ?? [];
        const candidates: { readonly iacFolder: vscode.Uri; readonly label: string }[] = [];

        for (const folder of folders) {
            const yamlFiles = await this.azd.findAzureYaml(folder.uri);
            if (yamlFiles.length === 0) {
                continue;
            }
            const iacFolder = this.ctx.code.Uri.joinPath(yamlFiles[0], '..');
            if (await this.hasStaticWebAppService(iacFolder)) {
                candidates.push({ iacFolder, label: folder.name });
            }
        }

        if (candidates.length === 0) {
            void this.ctx.code.window.showInformationMessage(this.ctx.code.l10n.t(
                'No Static Web Apps project is open. Open the folder containing your project\'s azure.yaml and try again.',
            ));
            return undefined;
        }

        if (candidates.length === 1) {
            return { iacFolder: candidates[0].iacFolder };
        }

        const selected = await this.ctx.code.window.showQuickPick(
            candidates.map(candidate => ({ label: candidate.label, iacFolder: candidate.iacFolder })),
            { placeHolder: this.ctx.code.l10n.t('Select the Static Web Apps project to deploy') },
        );
        return selected ? { iacFolder: selected.iacFolder } : undefined;
    }

    /** Reads `azure.yaml` directly and checks for a `host: staticwebapp` service. */
    private async hasStaticWebAppService(iacFolder: vscode.Uri): Promise<boolean> {
        const yamlFiles = await this.azd.findAzureYaml(iacFolder);
        if (yamlFiles.length === 0) {
            return false;
        }
        let source: string;
        try {
            source = new TextDecoder().decode(await this.ctx.code.workspace.fs.readFile(yamlFiles[0]));
        } catch {
            return false;
        }
        let parsed: unknown;
        try {
            parsed = parse(source);
        } catch {
            return false;
        }
        if (!isRecord(parsed) || !isRecord(parsed.services)) {
            return false;
        }
        return Object.values(parsed.services).some(
            service => isRecord(service) && typeof service.host === 'string' && service.host.toLowerCase() === 'staticwebapp',
        );
    }

    /**
     * Checks whether the *other* provider's canonical workflow file already
     * exists, and if so, requires explicit confirmation before continuing --
     * never deletes or overwrites either file.
     */
    private async confirmProviderSwitch(iacFolder: vscode.Uri, provider: 'github' | 'azdo'): Promise<boolean> {
        const otherPaths = provider === 'github' ? azdoWorkflowPaths : githubWorkflowPaths;
        if (!await this.anyFileExists(iacFolder, otherPaths)) {
            return true;
        }

        const otherLabel = provider === 'github' ? this.ctx.code.l10n.t('Azure Pipelines') : this.ctx.code.l10n.t('GitHub Actions');
        const newLabel = provider === 'github' ? this.ctx.code.l10n.t('GitHub Actions') : this.ctx.code.l10n.t('Azure Pipelines');
        const continueLabel = this.ctx.code.l10n.t('Continue');
        const selection = await this.ctx.code.window.showWarningMessage(
            this.ctx.code.l10n.t(
                'A {0} pipeline is already configured for this project. Configuring {1} as well will leave both pipelines active.',
                otherLabel,
                newLabel,
            ),
            { modal: true },
            continueLabel,
        );
        return selection === continueLabel;
    }

    private async anyFileExists(iacFolder: vscode.Uri, relativePaths: readonly string[]): Promise<boolean> {
        for (const relativePath of relativePaths) {
            try {
                await this.ctx.code.workspace.fs.stat(this.ctx.code.Uri.joinPath(iacFolder, relativePath));
                return true;
            } catch {
                // Not found -- check the next candidate path.
            }
        }
        return false;
    }

    private async configureCicd(iacFolder: vscode.Uri, provider: 'github' | 'azdo', environmentName?: string): Promise<void> {
        const handle = this.codeProvider.trackDeployment({ title: 'azd pipeline config' });
        void this.ctx.code.commands.executeCommand(`${ActivityTreeViewId}.focus`);
        try {
            await this.azd.pipelineConfig(iacFolder, provider, environmentName);
            handle.complete('Completed');
        } catch (e) {
            handle.complete('Failed', e);
            this.actionContext.errorHandling.suppress = 'display';
            throw e;
        }
    }

    /**
     * Direct deployment via the existing, unmodified `azd deploy`. For a
     * `host: staticwebapp` service, this uploads the configured `dist`
     * artifact through azd's existing Static Web Apps CLI integration -- no
     * new build/deploy behavior is introduced here.
     *
     * Refuses to run for Next.js hybrid/SSR projects (`azd deploy` cannot
     * deploy server-rendered content); shows guidance instead of pretending
     * deployment succeeded.
     */
    private async directDeploy(iacFolder: vscode.Uri): Promise<void> {
        const detection = await detectStaticWebAppProject(this.ctx.code, iacFolder);
        if (detection.primaryPresetId === 'nextjs') {
            void this.ctx.code.window.showErrorMessage(this.ctx.code.l10n.t(
                'This Next.js app uses server-side rendering, which cannot be deployed directly. Connect a pushed GitHub or Azure DevOps repository and run this command again to configure CI/CD.',
            ));
            return;
        }

        const handle = this.codeProvider.trackDeployment({ title: 'azd deploy' });
        void this.ctx.code.commands.executeCommand(`${ActivityTreeViewId}.focus`);
        try {
            await this.azd.deploy(iacFolder);
            handle.complete('Completed');
        } catch (e) {
            handle.complete('Failed', e);
            this.actionContext.errorHandling.suppress = 'display';
            throw e;
        }
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
