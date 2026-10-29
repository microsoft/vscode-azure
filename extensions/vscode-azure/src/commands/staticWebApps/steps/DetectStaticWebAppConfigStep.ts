/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, ICodeContext, PromptStep, showMessage } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { ISwaCliService } from '../../../staticWebApps/SwaCliService';
import { canAzdDeployStaticWebApp, tryGetStaticWebAppsCliConfig, type SWACLIOptions } from '../../../staticWebApps/SwaCliConfig';
import { requireWorkspaceTrust } from '../../../utils/workspaceTrust';
import type { CreateStaticWebAppContext, StaticWebAppAzdLanguage } from '../CreateStaticWebAppContext';

/** Defaults the Static Web Apps build applies when a path is not stated. */
const DefaultAppLocation = '/';
const DefaultApiLocation = '';
const DefaultOutputLocation = '';

/**
 * Resolves a project's Static Web Apps layout without asking the user.
 *
 * @remarks
 * A layout the user has already declared in `swa-cli.config.json` wins, because
 * that file is what a later `swa build` reads. Otherwise the CLI detects the
 * project, so the framework table stays the CLI's to maintain rather than being
 * mirrored here.
 *
 * This is a {@linkcode PromptStep} because it contributes to the context rather
 * than because it asks anything; running before {@linkcode ConfirmProvisionStep}
 * lets the confirmation reflect what will actually be deployed.
 */
@injectable()
export class DetectStaticWebAppConfigStep extends PromptStep<CreateStaticWebAppContext> {
    public constructor(
        @inject(IActionContext) private readonly actionContext: IActionContext,
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(ISwaCliService) private readonly swa: ISwaCliService,
    ) {
        super();
    }

    public override shouldPrompt(context: Readonly<CreateStaticWebAppContext>): boolean {
        return !context.hasInfra
            && !!context.iacFolder
            && (context.appLocation === undefined
                || context.apiLocation === undefined
                || context.outputLocation === undefined);
    }

    /** @inheritdoc */
    public async prompt(context: Readonly<CreateStaticWebAppContext>): Promise<Partial<CreateStaticWebAppContext>> {
        const iacFolder = context.iacFolder;
        if (!iacFolder) {
            return {};
        }

        // Reading the declared configuration looks into the project, so an
        // untrusted workspace is refused here, before the first read.
        if (context.job !== 'createNew') {
            requireWorkspaceTrust(this.ctx.code);
        }

        const declaredConfig = await tryGetStaticWebAppsCliConfig(this.ctx.code, iacFolder);
        let options: SWACLIOptions;
        let swaCliConfig = declaredConfig;
        let swaCliConfigNeedsWrite = false;
        if (declaredConfig) {
            const configurations = declaredConfig.configurations;
            const configName = configurations ? Object.keys(configurations)[0] : undefined;
            if (!configurations || !configName) {
                throw new Error(this.ctx.code.l10n.t('The Static Web Apps CLI configuration does not define a project configuration.'));
            }
            options = configurations[configName];
            this.actionContext.telemetry.properties.swaLayoutSource = 'config';
        } else {
            const detected = await this.swa.detect(iacFolder, { scratch: context.job === 'createNew' });
            options = detected.options;
            swaCliConfig = detected.config;
            swaCliConfigNeedsWrite = context.job === 'deploy';
            this.actionContext.telemetry.properties.swaLayoutSource = 'cli';
        }

        const appLocation = normalize(options.appLocation) ?? DefaultAppLocation;
        const apiLocation = normalize(options.apiLocation) ?? DefaultApiLocation;
        const outputLocation = normalize(options.outputLocation) ?? DefaultOutputLocation;

        addLocationTelemetry(this.actionContext, 'appLocation', appLocation, DefaultAppLocation);
        addLocationTelemetry(this.actionContext, 'apiLocation', apiLocation, DefaultApiLocation);
        addLocationTelemetry(this.actionContext, 'outputLocation', outputLocation, DefaultOutputLocation);

        const deploySupported = canAzdDeployStaticWebApp(outputLocation);
        if (context.job === 'deploy' && !deploySupported) {
            void showMessage(this.ctx.code, this.ctx.code.l10n.t(
                'No deployable build output was found for this project, so the Static Web App will be provisioned but its code will not be deployed. Set "outputLocation" in {0} to a build output folder and run the command again to deploy.',
                'swa-cli.config.json',
            ), { severity: 'warning' });
        }

        return {
            appLocation,
            apiLocation,
            outputLocation,
            detectedLanguage: resolveLanguage(options),
            deploy: context.job === 'deploy' ? deploySupported : false,
            swaCliConfig: context.job === 'deploy' ? swaCliConfig : undefined,
            swaCliConfigNeedsWrite: swaCliConfigNeedsWrite && deploySupported,
        };
    }
}

function normalize(value: string | undefined): string | undefined {
    return value?.trim().replace(/\\/g, '/');
}

/** How a resolved location compares to the Static Web Apps default. */
type StaticWebAppLocationClassification = 'empty' | 'default' | 'nonDefault';

/**
 * Records how a resolved location compares to the Static Web Apps default,
 * without recording the path itself.
 */
function addLocationTelemetry(
    context: IActionContext,
    key: 'appLocation' | 'apiLocation' | 'outputLocation',
    value: string | undefined,
    defaultValue: string,
): void {
    if (value === undefined) {
        return;
    }

    let classification: StaticWebAppLocationClassification;
    if (value.length === 0) {
        classification = 'empty';
    } else if (value === defaultValue) {
        classification = 'default';
    } else {
        classification = 'nonDefault';
    }
    context.telemetry.properties[key] = classification;
}

/**
 * Maps the detected build to the language azd records on the service.
 *
 * The CLI reports a language for the API but not for the app, so an explicit
 * app build command takes precedence. An API-only Python project uses Python
 * for dependency restoration before `swa build` handles both app and API.
 */
function resolveLanguage(options: SWACLIOptions): StaticWebAppAzdLanguage {
    const appBuildCommand = options.appBuildCommand?.trim().toLowerCase();
    if (appBuildCommand?.startsWith('dotnet')) {
        return 'dotnet';
    }

    if (!appBuildCommand && options.apiLanguage?.trim().toLowerCase() === 'python') {
        return 'python';
    }

    return 'js';
}
