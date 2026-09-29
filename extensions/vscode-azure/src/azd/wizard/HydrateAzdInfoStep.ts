/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PromptStep, fileExists, type AsWritable, IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import { type AzdEnvironment, IAzdService } from '../AzdService';
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
 * - `hydratedServiceProjectPath` -- project path from `azd show`, only when
 *   exactly one service exists.
 * - `hasInfra` -- presence of `infra/main.bicep`.
 * - `existingDefaultEnvName` -- name of the default azd environment, *only*
 *   when that env is fully configured (has both `AZURE_SUBSCRIPTION_ID` and
 *   `AZURE_LOCATION`). Treated as Bootstrapped state downstream.
 * - `hydratedSubscriptionId` / `hydratedLocationName` -- pulled from the
 *   fully-configured env's values; used by the
 *   {@linkcode HydratableChooseSubscriptionStep} /
 *   {@linkcode HydratableChooseLocationStep} to skip their pickers.
 * - `hydratedTenantId` -- `AZURE_TENANT_ID` from the fully-configured env;
 *   forwarded as a hint when resolving the subscription of deployments this
 *   env provisions.
 *
 * If a default env exists but is *partially* configured (missing one or both
 * azure values), this step intentionally treats the wizard as Post-clone:
 * it leaves `existingDefaultEnvName` unset (so {@linkcode CreateAzdEnvStep}
 * runs) and seeds {@linkcode AzdWizardContext.environmentName environmentName}
 * with a non-colliding suffixed name (e.g. `dev-2`). The user's broken env
 * is left untouched -- the wizard never mutates an existing user env.
 *
 * For the `createNew` job this step is a no-op: the temp `iacFolder` is
 * always empty, so all flags would be `false` anyway.
 */
@injectable()
export class HydrateAzdInfoStep<TContext extends AzdWizardContext> extends PromptStep<TContext> {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IAzdService) private readonly azd: IAzdService,
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
            const serviceNames = show.services ? Object.keys(show.services) : [];
            result.hasServices = serviceNames.length > 0;

            if (serviceNames.length > 0) {
                result.azdServiceName = serviceNames[0];
            }
            result.hydratedServiceProjectPath = serviceNames.length === 1
                ? show.services?.[serviceNames[0]].project?.path
                : undefined;
        }

        result.hasInfra = await this.hasInfraTemplate(iacFolder);

        const envs = await this.tryListEnvironments(iacFolder);
        const defaultEnv = envs.find(e => e.IsDefault)?.Name;
        if (defaultEnv) {
            const values = await this.azd.envGetValues(defaultEnv, iacFolder);
            const sub = values.AZURE_SUBSCRIPTION_ID;
            const loc = values.AZURE_LOCATION;

            if (sub && loc) {
                // Fully Bootstrapped: reuse the existing env in place.
                result.existingDefaultEnvName = defaultEnv;
                result.environmentName = defaultEnv;
                result.hydratedSubscriptionId = sub;
                result.hydratedLocationName = loc;
                // The env is fully configured, so AZURE_TENANT_ID (when present)
                // is the owning tenant of the hydrated subscription -- safe to use
                // as a resolution hint for the deployments this env provisions.
                if (values.AZURE_TENANT_ID) {
                    result.hydratedTenantId = values.AZURE_TENANT_ID;
                }
            } else {
                // Partial Bootstrapped: the existing default env is missing
                // one or both azure values, so it can't be provisioned. Treat
                // as Post-clone -- leave existingDefaultEnvName unset (so
                // CreateAzdEnvStep runs) and seed environmentName with a
                // non-colliding suffix so `azd env new` won't fail.
                result.environmentName = nextAvailableSuffix(defaultEnv, new Set(envs.map(e => e.Name)));
            }
        }

        return result;
    }

    private async hasInfraTemplate(iacFolder: vscode.Uri): Promise<boolean> {
        return fileExists(this.code, this.code.Uri.joinPath(iacFolder, InfraFolderName, MainBicepFileName));
    }

    private async tryListEnvironments(cwd: vscode.Uri): Promise<AzdEnvironment[]> {
        try {
            return await this.azd.envList(cwd);
        } catch {
            // azd not installed or no environments -- ignore
            return [];
        }
    }
}

/**
 * Returns the smallest `${base}-N` (N >= 2) name that isn't in
 * {@linkcode taken}. Falls back to a base-36 random suffix if the search
 * range is exhausted.
 */
function nextAvailableSuffix(base: string, taken: ReadonlySet<string>): string {
    for (let i = 2; i < 1000; i++) {
        const candidate = `${base}-${i}`;
        if (!taken.has(candidate)) {
            return candidate;
        }
    }
    return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}
