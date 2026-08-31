/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, ICodeContext, PromptStep } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { ISwaCliService } from '../../../staticWebApps/SwaCliService';
import { tryGetStaticWebAppCliOptions, canAzdDeployStaticWebApp, type SWACLIOptions } from '../../../staticWebApps/SwaCliConfig';
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

        const declared = await tryGetStaticWebAppCliOptions(this.ctx.code, iacFolder);
        const options = declared ?? await this.swa.detect(iacFolder);
        this.actionContext.telemetry.properties.swaLayoutSource = declared ? 'config' : 'cli';

        const appLocation = normalize(options.appLocation) ?? DefaultAppLocation;
        const apiLocation = normalize(options.apiLocation) ?? DefaultApiLocation;
        const outputLocation = normalize(options.outputLocation) ?? DefaultOutputLocation;

        addLocationTelemetry(this.actionContext, 'appLocation', appLocation, DefaultAppLocation);
        addLocationTelemetry(this.actionContext, 'apiLocation', apiLocation, DefaultApiLocation);
        addLocationTelemetry(this.actionContext, 'outputLocation', outputLocation, DefaultOutputLocation);

        const deploySupported = canAzdDeployStaticWebApp(outputLocation);
        if (context.job === 'deploy' && !deploySupported) {
            void this.ctx.code.window.showWarningMessage(this.ctx.code.l10n.t(
                'No deployable build output was found for this project, so the Static Web App will be provisioned but its code will not be deployed. Set "outputLocation" in {0} to a build output folder and run the command again to deploy.',
                'swa-cli.config.json',
            ));
        }

        return {
            appLocation,
            apiLocation,
            outputLocation,
            detectedLanguage: resolveLanguage(options),
            deploy: context.job === 'deploy' ? deploySupported : false,
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
 * The CLI reports a language for the API but not for the app, so the app's
 * toolchain is taken from the build command it produced. azd treats `js` and
 * `ts` identically for Static Web Apps -- both run the project's npm build --
 * so the distinction is not worth recovering.
 */
function resolveLanguage(options: SWACLIOptions): StaticWebAppAzdLanguage {
    return options.appBuildCommand?.trim().toLowerCase().startsWith('dotnet') ? 'dotnet' : 'js';
}
