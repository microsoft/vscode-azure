/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PromptStep } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzdService, MinAzdPipelineVersion } from '../../../azd/AzdService';
import { IGitRemoteService } from '../../../staticWebApps/GitRemoteService';
import type { CreateStaticWebAppContext, StaticWebAppDeploymentBlockedReason } from '../CreateStaticWebAppContext';
import { canAzdDeployStaticWebApp } from './locationUtils';

/**
 * Silently routes Static Web Apps deployment during creation, without ever
 * showing UI (modeled on {@linkcode import('../../../azd/wizard/HydrateAzdInfoStep').HydrateAzdInfoStep HydrateAzdInfoStep}).
 * Runs last in `CreateStaticWebApp`'s prompt steps, once `iacFolder` and
 * `outputLocation` are already settled.
 *
 * Decision (mutually exclusive):
 * 1. A supported, pushed Git remote and a sufficient `azd` version -- CI/CD
 *    is possible regardless of artifact shape (Azure's managed build handles
 *    Next.js hybrid/SSR too) -- sets `deploy: false` and
 *    {@linkcode CreateStaticWebAppContext.deploymentRoute}. `AzdDeployStep`
 *    is naturally skipped by the `deploy: false` merge; no changes to that
 *    shared step are needed.
 * 2. CI/CD is not currently possible, but the artifact shape can be deployed
 *    directly (static/export-capable apps) -- returns `{}`, retaining
 *    whatever `deploy` already was (`true`), so `AzdDeployStep` runs direct
 *    deploy exactly as it does today.
 * 3. CI/CD is not currently possible *and* the artifact shape cannot be
 *    deployed directly (Next.js hybrid/SSR) -- explicitly forces
 *    `deploy: false` and sets
 *    {@linkcode CreateStaticWebAppContext.deploymentBlockedReason} so
 *    `CreateStaticWebApp` can show honest, reason-specific guidance instead
 *    of silently doing nothing. This is a defensive, explicit suppression --
 *    it does not rely on `OutputLocationStep`'s existing (still correct)
 *    gating as an implicit assumption.
 */
@injectable()
export class DetermineStaticWebAppDeploymentRouteStep extends PromptStep<CreateStaticWebAppContext> {
    public constructor(
        @inject(IGitRemoteService) private readonly gitRemote: IGitRemoteService,
        @inject(IAzdService) private readonly azd: IAzdService,
    ) {
        super();
    }

    public override shouldPrompt(context: Readonly<CreateStaticWebAppContext>): boolean {
        return context.job === 'deploy' && !!context.iacFolder;
    }

    public async prompt(context: Readonly<CreateStaticWebAppContext>): Promise<Partial<CreateStaticWebAppContext>> {
        // shouldPrompt guarantees iacFolder is set.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const iacFolder = context.iacFolder!;

        const canDirectDeploy = context.outputLocation !== undefined && canAzdDeployStaticWebApp(context.outputLocation);
        const remote = await this.gitRemote.getRemoteInfo(iacFolder);

        let blockedReason: StaticWebAppDeploymentBlockedReason | undefined;
        if (!remote) {
            blockedReason = 'noRemote';
        } else if (remote.provider === 'unsupported') {
            blockedReason = 'unsupportedRemote';
        } else if (!remote.hasUpstream) {
            blockedReason = 'notPushed';
        } else if (!await this.azd.checkVersion(MinAzdPipelineVersion)) {
            // Also covers "azd not installed" (checkVersion returns undefined) --
            // there is no distinct reason bucket for that in this slice; both
            // are azd-prerequisite failures with the same remediation (upgrade/install).
            blockedReason = 'azdVersionTooLow';
        }

        if (remote && remote.provider !== 'unsupported' && !blockedReason) {
            return {
                deploy: false,
                deploymentRoute: { provider: remote.provider, repositoryUrl: remote.url, branch: remote.branch },
            };
        }

        if (canDirectDeploy) {
            return {};
        }

        return { deploy: false, deploymentBlockedReason: blockedReason };
    }
}
