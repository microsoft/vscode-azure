/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    IActionContext,
    ICodeContext,
    PickWorkspaceLocationStep,
    PromptStep,
    showSmartInputBox,
    type WorkspaceLocation,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type { CreateStaticWebAppContext } from '../CreateStaticWebAppContext';
import { getStaticWebAppCliLocation } from '../../../staticWebApps/SwaCliConfig';
import { staticWebAppsAppLocationUrl } from '../staticWebAppLinks';
import { addLocationTelemetry, isYamlSafeLocation } from './locationUtils';

interface AppLocationPickContext {
    readonly location?: WorkspaceLocation;
}

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

    public async prompt(context: Readonly<CreateStaticWebAppContext>): Promise<Partial<CreateStaticWebAppContext>> {
        const defaultValue = context.detectedAppLocation ?? context.buildPreset?.appLocation ?? '/';
        const declared = await getStaticWebAppCliLocation(this.ctx.code, 'appLocation', context.iacFolder);
        const initialValue = declared || defaultValue;
        const appLocation = context.iacFolder && this.ctx.code.workspace.getWorkspaceFolder(context.iacFolder)
            ? await this.pickLocation(context.iacFolder, initialValue, [
                initialValue,
                context.detectedAppLocation,
                context.buildPreset?.appLocation,
                '/',
            ])
            : await this.promptForLocation(initialValue);
        addLocationTelemetry(this.actionContext, 'appLocation', appLocation, defaultValue, declared);
        return { appLocation };
    }

    private async pickLocation(
        workspaceRoot: WorkspaceLocation['uri'],
        value: string,
        suggestions: readonly (string | undefined)[],
    ): Promise<string> {
        const step = new PickWorkspaceLocationStep<AppLocationPickContext>(
            this.ctx,
            [
                { base: workspaceRoot.fsPath, baseUri: workspaceRoot, pattern: projectFileGlob },
                { base: workspaceRoot.fsPath, baseUri: workspaceRoot, pattern: excludedProjectDirectories },
            ],
            {
                kind: 'folder',
                contextProperty: 'location',
                relativeTo: workspaceRoot,
                suggestedRelativePaths: suggestions.filter((item): item is string => item !== undefined),
                value,
                allowCustom: true,
                isValidRelativePath: input => isYamlSafeLocation(input, 'app_location'),
                strings: {
                    title: this.ctx.code.l10n.t('Select the application code location'),
                    placeHolder: this.ctx.code.l10n.t('Choose a project folder or enter a location relative to the workspace root'),
                },
            },
        );
        const result = await step.prompt({});
        return result.location?.relativePath || '/';
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
