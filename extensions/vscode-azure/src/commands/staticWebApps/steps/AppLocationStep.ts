/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, ICodeContext, PromptStep, showSmartInputBox } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type { CreateStaticWebAppContext } from '../CreateStaticWebAppContext';
import { getStaticWebAppPathSetting } from '../StaticWebAppSettings';
import { staticWebAppsAppLocationUrl } from '../staticWebAppLinks';
import { addLocationTelemetry, isYamlSafeLocation } from './locationUtils';

/** Prompts for application source relative to the selected workspace root. */
@injectable()
export class AppLocationStep extends PromptStep<CreateStaticWebAppContext> {
    public constructor(
        @inject(IActionContext) private readonly actionContext: IActionContext,
        @inject(ICodeContext) private readonly ctx: ICodeContext,
    ) {
        super();
    }

    public override shouldPrompt(context: Readonly<CreateStaticWebAppContext>): boolean {
        return !context.hasInfra && context.appLocation === undefined;
    }

    public async prompt(context: Readonly<CreateStaticWebAppContext>): Promise<Partial<CreateStaticWebAppContext>> {
        const defaultValue = context.detectedAppLocation ?? context.buildPreset?.appLocation ?? '/';
        const setting = getStaticWebAppPathSetting(this.ctx.code, 'appLocation', context.iacFolder);
        const appLocation = (await showSmartInputBox(this.ctx, {
            value: setting || defaultValue,
            prompt: this.ctx.code.l10n.t(
                'Enter the application code location. Use \'/\' for the root or \'/app\' for an app folder. Learn more: {0}',
                staticWebAppsAppLocationUrl,
            ),
            showBack: true,
            validateInput: value => isYamlSafeLocation(value, 'app_location')
                ? undefined
                : this.ctx.code.l10n.t('Enter a value that is safe to use in YAML.'),
        })).trim();
        addLocationTelemetry(this.actionContext, 'appLocation', appLocation, defaultValue, setting);
        return { appLocation };
    }
}
