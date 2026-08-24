/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, ICodeContext, PromptStep, showSmartInputBox } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type { CreateStaticWebAppContext } from '../CreateStaticWebAppContext';
import { getStaticWebAppCliLocation } from '../../../staticWebApps/SwaCliConfig';
import { staticWebAppsOutputLocationUrl } from '../staticWebAppLinks';
import { addLocationTelemetry, canAzdDeployStaticWebApp, isYamlSafeLocation } from './locationUtils';

const angularOutputPlaceholder = 'dist/<project-name>';

/** Prompts for build output and gates unsupported direct azd deployment shapes. */
@injectable()
export class OutputLocationStep extends PromptStep<CreateStaticWebAppContext> {
    public constructor(
        @inject(IActionContext) private readonly actionContext: IActionContext,
        @inject(ICodeContext) private readonly ctx: ICodeContext,
    ) {
        super();
    }

    public override shouldPrompt(context: Readonly<CreateStaticWebAppContext>): boolean {
        return !context.hasInfra && context.outputLocation === undefined;
    }

    public async prompt(context: Readonly<CreateStaticWebAppContext>): Promise<Partial<CreateStaticWebAppContext>> {
        const defaultValue = resolveDefaultOutputLocation(context);
        const declared = await getStaticWebAppCliLocation(this.ctx.code, 'outputLocation', context.iacFolder);
        const outputLocation = (await showSmartInputBox(this.ctx, {
            value: declared || defaultValue,
            prompt: this.ctx.code.l10n.t(
                'Enter the build output relative to the app location, or leave it blank if there is no build. Learn more: {0}',
                staticWebAppsOutputLocationUrl,
            ),
            showBack: true,
            validateInput: value => {
                if (value === angularOutputPlaceholder) {
                    return this.ctx.code.l10n.t('The Angular project name must be resolved before deployment.');
                }
                return isYamlSafeLocation(value, 'output_location')
                    ? undefined
                    : this.ctx.code.l10n.t('Enter a value that is safe to use in YAML.');
            },
        })).trim();
        addLocationTelemetry(this.actionContext, 'outputLocation', outputLocation, defaultValue, declared);

        const deploySupported = canAzdDeployStaticWebApp(outputLocation);
        if (context.job === 'deploy' && !deploySupported) {
            void this.ctx.code.window.showWarningMessage(this.ctx.code.l10n.t(
                'The current azd Static Web Apps target requires a build output folder distinct from the source folder. The resource will be provisioned, but code deployment will be skipped for this output location.',
            ));
        }
        return {
            outputLocation,
            deploy: context.job === 'deploy' ? deploySupported : false,
        };
    }
}

/** Resolves the Angular placeholder so it is never emitted into Bicep or YAML. */
export function resolveDefaultOutputLocation(context: Readonly<CreateStaticWebAppContext>): string {
    const presetOutput = context.buildPreset?.outputLocation ?? 'build';
    if (presetOutput !== angularOutputPlaceholder) {
        return presetOutput;
    }
    const projectName = sanitizeProjectName(context.angularProjectName)
        ?? sanitizeProjectName(context.environmentName)
        ?? 'app';
    return `dist/${projectName}`;
}

function sanitizeProjectName(value: string | undefined): string | undefined {
    const sanitized = value?.trim().replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '');
    return sanitized || undefined;
}
