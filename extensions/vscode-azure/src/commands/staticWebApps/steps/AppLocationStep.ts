/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, ICodeContext, PromptStep, pickWorkspaceLocation } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type { CreateStaticWebAppContext } from '../CreateStaticWebAppContext';
import { getStaticWebAppCliLocation } from '../../../staticWebApps/SwaCliConfig';
import { staticWebAppsAppLocationUrl } from '../staticWebAppLinks';
import { addLocationTelemetry, isYamlSafeLocation, promptForYamlSafeLocation } from './locationUtils';

const projectFileGlob = '**/{package.json,angular.json,index.html,*.csproj,hugo.toml,hugo.yaml,hugo.yml,config.toml,config.yaml,config.yml,config.json}';
const excludedProjectDirectories = '**/{.git,.hg,.svn,node_modules,bower_components,vendor,bin,obj,target,build,dist,out,.next,.nuxt,.output,.svelte-kit,.venv,venv,__pycache__,.tox,.gradle,.terraform,coverage}/**';

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

    /** @inheritdoc */
    public async prompt(context: Readonly<CreateStaticWebAppContext>): Promise<Partial<CreateStaticWebAppContext>> {
        const defaultValue = context.detectedAppLocation ?? context.buildPreset?.appLocation ?? '/';
        const declared = await getStaticWebAppCliLocation(this.ctx.code, 'appLocation', context.iacFolder);
        const initialValue = declared || defaultValue;

        const appLocation = await this.pickLocation(context, initialValue);
        addLocationTelemetry(this.actionContext, 'appLocation', appLocation, defaultValue, declared);
        return { appLocation };
    }

    /**
     * Offers the project folders the workspace can express, and falls back to a typed path when
     * the project folder is unknown or lies outside the workspace, since the picker could then
     * only produce candidates the workspace cannot name.
     */
    private async pickLocation(context: Readonly<CreateStaticWebAppContext>, value: string): Promise<string> {
        const base = context.iacFolder;
        if (!base || !this.ctx.code.workspace.getWorkspaceFolder(base)) {
            return await promptForYamlSafeLocation(this.ctx, {
                key: 'app_location',
                value,
                prompt: this.ctx.code.l10n.t(
                    'Enter the application code location. Use \'/\' for the root or \'/app\' for an app folder. Learn more: {0}',
                    staticWebAppsAppLocationUrl,
                ),
            });
        }

        const location = await pickWorkspaceLocation(this.ctx, {
            kind: 'folder',
            strings: {
                title: this.ctx.code.l10n.t('Select the application code location'),
                placeHolder: this.ctx.code.l10n.t('Choose a project folder or enter a location relative to the workspace root'),
            },
            findFiles: [
                { base: base.fsPath, baseUri: base, pattern: projectFileGlob },
                { base: base.fsPath, baseUri: base, pattern: excludedProjectDirectories },
            ],
            relativeTo: base,
            value,
            suggestedRelativePaths: [
                value,
                context.detectedAppLocation,
                context.buildPreset?.appLocation,
                '/',
            ].filter((item): item is string => item !== undefined),
            allowCustom: true,
            isValidRelativePath: input => isYamlSafeLocation(input, 'app_location'),
        });

        return location?.relativePath || '/';
    }
}
