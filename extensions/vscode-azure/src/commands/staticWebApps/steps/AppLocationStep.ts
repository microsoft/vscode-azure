/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    IActionContext,
    ICodeContext,
    PickWorkspaceLocationStep,
    showSmartInputBox,
    type WorkspaceLocation,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type { CreateStaticWebAppContext } from '../CreateStaticWebAppContext';
import { getStaticWebAppCliLocation } from '../../../staticWebApps/SwaCliConfig';
import { staticWebAppsAppLocationUrl } from '../staticWebAppLinks';
import { addLocationTelemetry, isYamlSafeLocation } from './locationUtils';

interface AppLocationStepContext extends CreateStaticWebAppContext {
    readonly selectedLocation?: WorkspaceLocation;
}

const projectFileGlob = '**/{package.json,angular.json,index.html,*.csproj,hugo.toml,hugo.yaml,hugo.yml,config.toml,config.yaml,config.yml,config.json}';
const excludedProjectDirectories = '**/{.git,.hg,.svn,node_modules,bower_components,vendor,bin,obj,target,build,dist,out,.next,.nuxt,.output,.svelte-kit,.venv,venv,__pycache__,.tox,.gradle,.terraform,coverage}/**';

/** Prompts for application source relative to the selected workspace root. */
@injectable()
export class AppLocationStep extends PickWorkspaceLocationStep<AppLocationStepContext> {
    public constructor(
        @inject(IActionContext) private readonly actionContext: IActionContext,
        @inject(ICodeContext) ctx: ICodeContext,
    ) {
        super(
            ctx,
            [
                projectFileGlob,
                excludedProjectDirectories,
            ],
            {
                kind: 'folder',
                contextProperty: 'selectedLocation',
                allowCustom: true,
                isValidRelativePath: input => isYamlSafeLocation(input, 'app_location'),
                strings: {
                    title: ctx.code.l10n.t('Select the application code location'),
                    placeHolder: ctx.code.l10n.t('Choose a project folder or enter a location relative to the workspace root'),
                },
            },
        );
    }

    public override shouldPrompt(context: Readonly<CreateStaticWebAppContext>): boolean {
        return !context.hasInfra && context.appLocation === undefined;
    }

    public override async prompt(context: Readonly<AppLocationStepContext>): Promise<Partial<AppLocationStepContext>> {
        const defaultValue = context.detectedAppLocation ?? context.buildPreset?.appLocation ?? '/';
        const declared = await getStaticWebAppCliLocation(this.ctx.code, 'appLocation', context.iacFolder);
        const initialValue = declared || defaultValue;
        const appLocation = context.iacFolder && this.ctx.code.workspace.getWorkspaceFolder(context.iacFolder)
            ? (await this.pickLocation(context, {
                findFilesOptions: [
                    { base: context.iacFolder.fsPath, baseUri: context.iacFolder, pattern: projectFileGlob },
                    { base: context.iacFolder.fsPath, baseUri: context.iacFolder, pattern: excludedProjectDirectories },
                ],
                relativeTo: context.iacFolder,
                value: initialValue,
                suggestedRelativePaths: [
                    initialValue,
                    context.detectedAppLocation,
                    context.buildPreset?.appLocation,
                    '/',
                ].filter((item): item is string => item !== undefined),
            }))?.relativePath || '/'
            : await this.promptForLocation(initialValue);
        addLocationTelemetry(this.actionContext, 'appLocation', appLocation, defaultValue, declared);
        return { appLocation };
    }

    private async promptForLocation(value: string): Promise<string> {
        return (await showSmartInputBox(this.ctx, {
            value,
            prompt: this.ctx.code.l10n.t(
                'Enter the application code location. Use \'/\' for the root or \'/app\' for an app folder. Learn more: {0}',
                staticWebAppsAppLocationUrl,
            ),
            showBack: true,
            validateInput: input => isYamlSafeLocation(input, 'app_location')
                ? undefined
                : this.ctx.code.l10n.t('Enter a value that is safe to use in YAML.'),
        })).trim();
    }
}
