/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep, IActionContext, IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { ActivityTreeViewId } from '../../constants';
import { ICodeDeploymentDataProvider } from '../../tree/activity/CodeDeploymentDataProvider';
import { IAzdService, MinAzdPipelineVersion } from '../AzdService';
import type { AzdWizardContext } from './AzdWizardContext';

/**
 * Runs `azd pipeline config` to set up a CI/CD pipeline for the project.
 *
 * `azd` owns the entire interaction: it prompts for the provider, creates and
 * pushes a repository when the project has no remote yet, and authenticates
 * against the provider. Inspecting the Git remote here beforehand would only
 * take capabilities away.
 *
 * A successful run means the pipeline is configured, not that code has been
 * deployed -- that happens on the next push.
 */
@injectable()
export class AzdPipelineConfigStep<TContext extends AzdWizardContext> extends ExecuteStep<TContext> {
    public constructor(
        @inject(IActionContext) private readonly actionContext: IActionContext,
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IAzdService) private readonly azd: IAzdService,
        @inject(ICodeDeploymentDataProvider) private readonly codeProvider: ICodeDeploymentDataProvider,
    ) {
        super();
    }

    public override shouldExecute(context: Readonly<TContext>): boolean {
        return !!context.iacFolder;
    }

    public async execute(context: Readonly<TContext>): Promise<void> {
        // Enforced whichever provider the user goes on to pick: the floor exists
        // for Azure DevOps, and `azd` only asks which provider to use once it is
        // already running, so failing here beats failing part-way through setup.
        // `undefined` means no version could be read at all, in which case
        // `pipelineConfig` raises the "not found" install prompt instead.
        if (await this.azd.checkVersion(MinAzdPipelineVersion) === false) {
            this.actionContext.errorHandling.suppress = 'display';
            throw new Error(this.code.l10n.t(
                'Azure Developer CLI (azd) version {0} or later is required to configure CI/CD.',
                MinAzdPipelineVersion,
            ));
        }

        const handle = this.codeProvider.trackDeployment({ title: 'azd pipeline config' });

        void this.code.commands.executeCommand(`${ActivityTreeViewId}.focus`);

        try {
            await this.azd.pipelineConfig(context.iacFolder!, undefined, context.environmentName); // eslint-disable-line @typescript-eslint/no-non-null-assertion
            handle.complete('Completed');
            void this.code.window.showInformationMessage(this.code.l10n.t(
                'CI/CD configured. Push to the configured branch to trigger a deployment.',
            ));
        } catch (e) {
            handle.complete('Failed', e);
            this.actionContext.errorHandling.suppress = 'display';
            throw e;
        }
    }
}
