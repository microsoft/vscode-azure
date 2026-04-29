/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AsWritable, PromptStep, type IVsCode } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';
import type { IAzdService } from '../AzdService';
import type { AzdWizardContext } from './AzdWizardContext';
import { InfraFolderName, MainBicepFileName } from './GenerateBicepStep';

/**
 * Silently classifies the existing azd state in {@linkcode AzdWizardContext.iacFolder}
 * (only when {@linkcode AzdWizardContext.job job} is `deploy`) so subsequent
 * prompt and execute steps can skip work that is already done. Never prompts
 * the user.
 *
 * Detected signals (all best-effort -- failures leave the flag unset):
 * - `hasAzureYaml` / `hasServices` -- derived from `azd show --output json`.
 * - `hasInfra` -- presence of `infra/main.bicep`.
 * - `existingDefaultEnvName` -- name of the default azd environment, if any.
 * - `hydratedSubscriptionId` / `hydratedLocationName` -- `AZURE_SUBSCRIPTION_ID`
 *   and `AZURE_LOCATION` from the existing default env, used by the
 *   {@linkcode HydratableChooseSubscriptionStep} /
 *   {@linkcode HydratableChooseLocationStep} to skip their pickers.
 *
 * For the `createNew` job this step is a no-op: the temp `iacFolder` is
 * always empty, so all flags would be `false` anyway.
 */
export class HydrateAzdInfoStep<TContext extends AzdWizardContext> extends PromptStep<TContext> {
    public constructor(
        private readonly code: IVsCode,
        private readonly azd: IAzdService,
    ) {
        super();
    }

    public override shouldPrompt(context: Readonly<TContext>): boolean {
        return context.job === 'deploy' && !!context.iacFolder;
    }

    public async prompt(context: Readonly<TContext>): Promise<Partial<TContext>> {
        const iacFolder = context.iacFolder!; // eslint-disable-line @typescript-eslint/no-non-null-assertion

        const result = {} as AsWritable<Partial<TContext>>;

        // `azd show` is the source of truth for project + service info. It
        // fails (returns undefined) when there is no `azure.yaml`, which is
        // exactly the signal we want for `hasAzureYaml`.
        const show = await this.azd.show(iacFolder);
        if (show) {
            result.hasAzureYaml = true;
            result.hasServices = !!show.services && Object.keys(show.services).length > 0;
        }

        result.hasInfra = await this.hasInfraTemplate(iacFolder);

        const envName = await this.findDefaultEnvironment(iacFolder);
        if (envName) {
            result.existingDefaultEnvName = envName;
            result.environmentName = envName;

            // Pull seeded values from the existing env so we can skip the
            // sub/location pickers. Best-effort: missing values just mean we
            // fall back to prompting.
            const values = await this.azd.envGetValues(envName, iacFolder);
            if (values.AZURE_SUBSCRIPTION_ID) {
                result.hydratedSubscriptionId = values.AZURE_SUBSCRIPTION_ID;
            }
            if (values.AZURE_LOCATION) {
                result.hydratedLocationName = values.AZURE_LOCATION;
            }
        }

        return result;
    }

    private async hasInfraTemplate(iacFolder: vscode.Uri): Promise<boolean> {
        try {
            await this.code.workspace.fs.stat(this.code.Uri.joinPath(iacFolder, InfraFolderName, MainBicepFileName));
            return true;
        } catch {
            return false;
        }
    }

    private async findDefaultEnvironment(cwd: vscode.Uri): Promise<string | undefined> {
        try {
            const envs = await this.azd.envList(cwd);
            const defaultEnv = envs.find(e => e.IsDefault);
            return defaultEnv?.Name;
        } catch {
            // azd not installed or no environments -- ignore
            return undefined;
        }
    }
}
