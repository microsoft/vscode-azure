/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    IActionContext,
    ICodeContext,
    NoWorkspaceLocationError,
    PickWorkspaceLocationStep,
    type FindWorkspaceFilesOptions,
    type PickWorkspaceLocationOptions,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type { CreateStaticWebAppContext } from '../CreateStaticWebAppContext';
import { getStaticWebAppCliLocation } from '../../../staticWebApps/SwaCliConfig';
import { staticWebAppsAppLocationUrl } from '../staticWebAppLinks';
import {
    addLocationTelemetry,
    derivePerPrompt,
    isYamlSafeLocation,
    promptForYamlSafeLocation,
    requireWorkspaceBase,
} from './locationUtils';

const projectFileGlob = '**/{package.json,angular.json,index.html,*.csproj,hugo.toml,hugo.yaml,hugo.yml,config.toml,config.yaml,config.yml,config.json}';
const excludedProjectDirectories = '**/{.git,.hg,.svn,node_modules,bower_components,vendor,bin,obj,target,build,dist,out,.next,.nuxt,.output,.svelte-kit,.venv,venv,__pycache__,.tox,.gradle,.terraform,coverage}/**';

/**
 * Configuration for the shared picker, plus the typed-path prompt used when the
 * workspace cannot offer folders to pick from. Both are built together so they
 * share one derivation of the prefill and its telemetry.
 */
interface AppLocationParts {
    readonly options: PickWorkspaceLocationOptions<CreateStaticWebAppContext>;
    readonly promptForTypedLocation: (
        context: Readonly<CreateStaticWebAppContext>,
    ) => Promise<Partial<CreateStaticWebAppContext>>;
}

function createAppLocationParts(ctx: ICodeContext, actionContext: IActionContext): AppLocationParts {
    const derive = derivePerPrompt(async (context: Readonly<CreateStaticWebAppContext>) => {
        const defaultValue = context.detectedAppLocation ?? context.buildPreset?.appLocation ?? '/';
        const declared = await getStaticWebAppCliLocation(ctx.code, 'appLocation', context.iacFolder);
        return { defaultValue, declared, initialValue: declared || defaultValue };
    });

    const toResult = async (
        context: Readonly<CreateStaticWebAppContext>,
        appLocation: string,
    ): Promise<Partial<CreateStaticWebAppContext>> => {
        const { defaultValue, declared } = await derive(context);
        addLocationTelemetry(actionContext, 'appLocation', appLocation, defaultValue, declared);
        return { appLocation };
    };

    return {
        options: {
            kind: 'folder',
            allowCustom: true,
            isValidRelativePath: input => isYamlSafeLocation(input, 'app_location'),
            strings: {
                title: ctx.code.l10n.t('Select the application code location'),
                placeHolder: ctx.code.l10n.t('Choose a project folder or enter a location relative to the workspace root'),
            },
            relativeTo: context => requireWorkspaceBase(ctx, context.iacFolder),
            findFiles: (context): FindWorkspaceFilesOptions => {
                const base = requireWorkspaceBase(ctx, context.iacFolder);
                return [
                    { base: base.fsPath, baseUri: base, pattern: projectFileGlob },
                    { base: base.fsPath, baseUri: base, pattern: excludedProjectDirectories },
                ];
            },
            value: async context => (await derive(context)).initialValue,
            suggestedRelativePaths: async context => [
                (await derive(context)).initialValue,
                context.detectedAppLocation,
                context.buildPreset?.appLocation,
                '/',
            ].filter((item): item is string => item !== undefined),
            toContext: (location, context) => toResult(context, location?.relativePath || '/'),
        },
        promptForTypedLocation: async context => toResult(context, await promptForYamlSafeLocation(ctx, {
            key: 'app_location',
            value: (await derive(context)).initialValue,
            prompt: ctx.code.l10n.t(
                'Enter the application code location. Use \'/\' for the root or \'/app\' for an app folder. Learn more: {0}',
                staticWebAppsAppLocationUrl,
            ),
        })),
    };
}

/** Prompts for application source relative to the selected workspace root. */
@injectable()
export class AppLocationStep extends PickWorkspaceLocationStep<CreateStaticWebAppContext> {
    private readonly promptForTypedLocation: AppLocationParts['promptForTypedLocation'];

    public constructor(
        @inject(IActionContext) actionContext: IActionContext,
        @inject(ICodeContext) ctx: ICodeContext,
    ) {
        const parts = createAppLocationParts(ctx, actionContext);
        super(ctx, parts.options);
        this.promptForTypedLocation = parts.promptForTypedLocation;
    }

    public override shouldPrompt(context: Readonly<CreateStaticWebAppContext>): boolean {
        return !context.hasInfra && context.appLocation === undefined;
    }

    /**
     * @inheritdoc
     * @remarks
     * A project folder outside the workspace leaves the picker nothing valid to
     * offer, so the location is typed instead.
     */
    public override async prompt(
        context: Readonly<CreateStaticWebAppContext>,
    ): Promise<Partial<CreateStaticWebAppContext>> {
        try {
            return await super.prompt(context);
        } catch (error) {
            if (!(error instanceof NoWorkspaceLocationError)) {
                throw error;
            }
            return await this.promptForTypedLocation(context);
        }
    }
}
