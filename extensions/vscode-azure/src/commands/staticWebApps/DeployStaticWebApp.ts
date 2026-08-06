/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, ICodeContext } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import { IAzdService, MinAzdPipelineVersion } from '../../azd/AzdService';
import { ActivityTreeViewId } from '../../constants';
import { IGitRemoteService, type GitRemoteProvider } from '../../staticWebApps/GitRemoteService';
import { ICodeDeploymentDataProvider } from '../../tree/activity/CodeDeploymentDataProvider';
import type { ManagedCommand } from '../ManagedCommand';
import { getStaticWebAppServiceConfig, hasConflictingProviderWorkflow, resolveStaticWebAppServiceProjectFolder, type StaticWebAppAutoDeployEligibility } from './deploymentRouting';
import { detectStaticWebAppProject } from './steps/frameworkDetection';
import { canAzdDeployStaticWebApp } from './steps/locationUtils';

/**
 * Known-good context for {@linkcode DeployStaticWebApp}, supplied by a caller
 * (e.g. `CreateStaticWebApp`, immediately after a successful create) that has
 * already resolved the project and its Git remote. When supplied with a
 * `provider`, the command trusts it and skips fresh remote resolution;
 * omitting `provider` forces a fresh {@linkcode IGitRemoteService.getRemoteInfo}
 * lookup even when `iacFolder` is already known.
 */
export interface DeployStaticWebAppArgs {
    readonly iacFolder: vscode.Uri;
    readonly environmentName?: string;
    /** Known CI/CD-eligible provider. Omit to force fresh remote resolution. */
    readonly provider?: 'github' | 'azdo';
    readonly repositoryUrl?: string;
    readonly branch?: string;
    /**
     * Whether the caller already determined this project's artifact shape
     * supports automatic deployment (direct or CI/CD) -- i.e. the same
     * decision `CreateStaticWebApp` made via
     * `DetermineStaticWebAppDeploymentRouteStep`. When supplied, trusted as-is
     * and fresh framework detection is skipped entirely, so creation and this
     * follow-up command always agree even for a monorepo or a user-overridden
     * output location that a heuristic re-scan might classify differently.
     * Always `true` when `CreateStaticWebApp` launches this command (it only
     * does so when its own routing step determined the artifact was
     * supported). Omit to force fresh `detectStaticWebAppProject` detection
     * (standalone/command-palette invocation).
     */
    readonly artifactSupportsAutoDeploy?: boolean;
}

/**
 * Standalone, repeatable Static Web Apps deployment router.
 *
 * Chooses between direct deployment (`azd deploy`, unmodified) and CI/CD
 * setup (`azd pipeline config`) based solely on the project's existing Git
 * remote -- never assists with initializing, adding, or pushing one.
 *
 * **Direct deployment support is determined first, before any routing
 * decision.** For standalone invocation this combines two independent
 * signals: Next.js hybrid/SSR projects can be deployed by *neither* path
 * (direct `azd deploy` cannot serve server-rendered content, and the
 * workflow `azd pipeline config` generates only runs `azd deploy` too), and
 * the existing `host: staticwebapp` service's actual `dist` value must be
 * valid (an absent service, or one with a missing/non-string/empty/`.`/`/`
 * `dist`, means there is no valid deploy target either way). Both are
 * checked immediately, before the Git remote is even inspected, and
 * short-circuit with honest guidance instead of attempting (or silently
 * skipping) a deployment that cannot work.
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

        // Determine whether direct deployment (and therefore CI/CD, which only
        // runs `azd deploy` too) is supported *before* any routing decision.
        // Trust the caller's decision when supplied (creation already made this
        // call via DetermineStaticWebAppDeploymentRouteStep) rather than
        // re-detecting -- a fresh heuristic scan could disagree with the
        // wizard's explicit preset/output choices in a monorepo or override
        // scenario. Only run fresh detection for standalone invocation.
        const eligibility: StaticWebAppAutoDeployEligibility = args?.artifactSupportsAutoDeploy === undefined
            ? await this.resolveEligibility(iacFolder)
            : (args.artifactSupportsAutoDeploy ? 'supported' : 'invalidServiceConfig');
        if (eligibility !== 'supported') {
            this.actionContext.telemetry.properties.deploymentRoute = 'unsupportedArtifact';
            this.showUnsupportedArtifactGuidance(eligibility);
            return;
        }

        let provider: GitRemoteProvider | undefined = args?.provider;
        let hasUpstream = !!args?.provider;
        let branch = args?.branch;

        if (!args?.provider) {
            const remote = await this.gitRemote.getRemoteInfo(iacFolder);
            provider = remote?.provider;
            hasUpstream = !!remote?.hasUpstream;
            branch = remote?.branch;
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
        await this.configureCicd(iacFolder, provider, environmentName, branch);
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

    /** Checks for an existing `host: staticwebapp` service in `azure.yaml`. */
    private async hasStaticWebAppService(iacFolder: vscode.Uri): Promise<boolean> {
        return await getStaticWebAppServiceConfig(this.azd, this.ctx.code, iacFolder) !== undefined;
    }

    /**
     * Fresh (standalone-invocation-only) determination of whether automatic
     * deployment is supported. Framework/hybrid-SSR status is checked ahead
     * of the existing service's `dist` validity, since Next.js hybrid/SSR is
     * an independent, architectural reason unrelated to whether `dist`
     * happens to look valid -- a hybrid/SSR project is always `'hybridSsr'`,
     * never misreported as a generic configuration problem, and vice versa: a
     * plain misconfigured static project is never described with Next.js
     * wording.
     *
     * Detects the framework at the existing service's own `project` folder
     * (from `azure.yaml`) rather than scanning the whole workspace. `project`
     * is required (never assumed to default to `iacFolder`) and must resolve
     * to an existing directory following azd's path semantics -- an invalid
     * path is `'invalidServiceConfig'`, never a silent fallback to scanning
     * `iacFolder` itself.
     */
    private async resolveEligibility(iacFolder: vscode.Uri): Promise<StaticWebAppAutoDeployEligibility> {
        const serviceConfig = await getStaticWebAppServiceConfig(this.azd, this.ctx.code, iacFolder);
        if (!serviceConfig) {
            return 'invalidServiceConfig';
        }

        const projectFolder = await resolveStaticWebAppServiceProjectFolder(this.ctx.code, iacFolder, serviceConfig.project);
        if (!projectFolder) {
            return 'invalidServiceConfig';
        }

        const detection = await detectStaticWebAppProject(this.ctx.code, projectFolder);
        if (detection.primaryPresetId === 'nextjs') {
            return 'hybridSsr';
        }

        return serviceConfig.dist !== undefined && canAzdDeployStaticWebApp(serviceConfig.dist) ? 'supported' : 'invalidServiceConfig';
    }

    /**
     * Checks whether the *other* provider's canonical workflow file already
     * exists, and if so, requires explicit confirmation before continuing --
     * never deletes or overwrites either file.
     */
    private async confirmProviderSwitch(iacFolder: vscode.Uri, provider: 'github' | 'azdo'): Promise<boolean> {
        if (!await hasConflictingProviderWorkflow(this.ctx.code, iacFolder, provider)) {
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

    /**
     * Configures CI/CD via `azd pipeline config`. Owns its own outcome
     * messaging -- a successful run here means the pipeline is configured,
     * not that code has been deployed yet (that happens on the next push).
     * `azd` configures whichever branch is currently checked out/tracked, not
     * necessarily the repository's default branch, so the message names the
     * known branch when available rather than assuming "default".
     */
    private async configureCicd(iacFolder: vscode.Uri, provider: 'github' | 'azdo', environmentName?: string, branch?: string): Promise<void> {
        const handle = this.codeProvider.trackDeployment({ title: 'azd pipeline config' });
        void this.ctx.code.commands.executeCommand(`${ActivityTreeViewId}.focus`);
        try {
            await this.azd.pipelineConfig(iacFolder, provider, environmentName);
            handle.complete('Completed');
            const providerLabel = provider === 'github' ? this.ctx.code.l10n.t('GitHub Actions') : this.ctx.code.l10n.t('Azure Pipelines');
            const message = branch
                ? this.ctx.code.l10n.t('{0} CI/CD configured for the "{1}" branch. Push to it to trigger a deployment.', providerLabel, branch)
                : this.ctx.code.l10n.t('{0} CI/CD configured for the configured branch. Push to it to trigger a deployment.', providerLabel);
            void this.ctx.code.window.showInformationMessage(message);
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
     * Callers must already have confirmed direct deployment is supported
     * (Next.js hybrid/SSR is checked once, up front, in {@linkcode execute}) --
     * this method assumes that and always attempts the deploy.
     */
    private async directDeploy(iacFolder: vscode.Uri): Promise<void> {
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

    /**
     * Shown when the project cannot be deployed by this command at all --
     * never claims a deployment occurred. Wording is reason-specific so a
     * plain misconfiguration is never described as Next.js-specific, and vice
     * versa.
     */
    private showUnsupportedArtifactGuidance(reason: Exclude<StaticWebAppAutoDeployEligibility, 'supported'>): void {
        const message = reason === 'hybridSsr'
            ? this.ctx.code.l10n.t(
                'This Next.js app uses server-side rendering, which cannot be deployed directly or through the '
                + 'generated CI/CD workflow (both require an output distinct from the source, and neither runs a '
                + 'server). Deploy it manually, or adjust the build to produce a supported static output.',
            )
            : this.ctx.code.l10n.t(
                'This project\'s Static Web Apps configuration (azure.yaml) doesn\'t declare a valid deployable '
                + 'output -- direct deployment and the generated CI/CD workflow both require a `host: staticwebapp` '
                + 'service with an output ("dist") distinct from the source. Fix the configuration, then try again.',
            );
        void this.ctx.code.window.showErrorMessage(message);
    }
}
