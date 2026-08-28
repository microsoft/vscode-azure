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
import type * as vscode from 'vscode';
import type { CreateStaticWebAppContext } from '../CreateStaticWebAppContext';
import { getStaticWebAppCliLocation } from '../../../staticWebApps/SwaCliConfig';
import { staticWebAppsOutputLocationUrl } from '../staticWebAppLinks';
import {
    addLocationTelemetry,
    canAzdDeployStaticWebApp,
    derivePerPrompt,
    isYamlSafeLocation,
    promptForYamlSafeLocation,
    requireWorkspaceBase,
} from './locationUtils';

const angularOutputPlaceholder = 'dist/<project-name>';
const excludedDependencyDirectories = '**/{.git,.hg,.svn,node_modules,bower_components,vendor,.venv,venv,__pycache__,.tox,.gradle,.terraform}/**';

/**
 * Configuration for the shared picker, plus the typed-path prompt used when the
 * workspace cannot offer folders to pick from. Both are built together so they
 * share one derivation of the prefill, its telemetry, and the deployability
 * verdict.
 */
interface OutputLocationParts {
    readonly options: PickWorkspaceLocationOptions<CreateStaticWebAppContext>;
    readonly promptForTypedLocation: (
        context: Readonly<CreateStaticWebAppContext>,
    ) => Promise<Partial<CreateStaticWebAppContext>>;
}

function createOutputLocationParts(ctx: ICodeContext, actionContext: IActionContext): OutputLocationParts {
    const derive = derivePerPrompt(async (context: Readonly<CreateStaticWebAppContext>) => {
        const defaultValue = resolveDefaultOutputLocation(context);
        const declared = await getStaticWebAppCliLocation(ctx.code, 'outputLocation', context.iacFolder);
        return { defaultValue, declared, initialValue: declared || defaultValue };
    });

    /** Build output is named relative to the app, not to the workspace root. */
    const resolveAppRoot = (context: Readonly<CreateStaticWebAppContext>): vscode.Uri => {
        const appLocation = context.appLocation ?? context.detectedAppLocation ?? context.buildPreset?.appLocation ?? '/';
        const normalized = appLocation.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        const iacFolder = context.iacFolder;
        return requireWorkspaceBase(
            ctx,
            iacFolder && normalized ? ctx.code.Uri.joinPath(iacFolder, normalized) : iacFolder,
        );
    };

    const toResult = async (
        context: Readonly<CreateStaticWebAppContext>,
        outputLocation: string,
    ): Promise<Partial<CreateStaticWebAppContext>> => {
        const { defaultValue, declared } = await derive(context);
        addLocationTelemetry(actionContext, 'outputLocation', outputLocation, defaultValue, declared);

        const deploySupported = canAzdDeployStaticWebApp(outputLocation);
        if (context.job === 'deploy' && !deploySupported) {
            void ctx.code.window.showWarningMessage(ctx.code.l10n.t(
                'The current azd Static Web Apps target requires a build output folder distinct from the source folder. The resource will be provisioned, but code deployment will be skipped for this output location.',
            ));
        }
        return {
            outputLocation,
            deploy: context.job === 'deploy' ? deploySupported : false,
        };
    };

    return {
        options: {
            kind: 'folder',
            allowCustom: true,
            noneLabel: ctx.code.l10n.t('$(circle-slash) No build output'),
            isValidRelativePath: input => input !== angularOutputPlaceholder
                && isYamlSafeLocation(input, 'output_location'),
            strings: {
                title: ctx.code.l10n.t('Select the build output location'),
                placeHolder: ctx.code.l10n.t('Choose a folder, enter a location relative to the app, or select no build output'),
            },
            relativeTo: resolveAppRoot,
            findFiles: (context): FindWorkspaceFilesOptions => {
                const appRoot = resolveAppRoot(context);
                return [
                    { base: appRoot.fsPath, baseUri: appRoot, pattern: '**/*' },
                    { base: appRoot.fsPath, baseUri: appRoot, pattern: excludedDependencyDirectories },
                    1000,
                ];
            },
            value: async context => (await derive(context)).initialValue,
            suggestedRelativePaths: async context => [
                (await derive(context)).initialValue,
                context.detectedOutputLocation,
                context.buildPreset?.outputLocation,
            ].filter((item): item is string => !!item && item !== angularOutputPlaceholder),
            toContext: (location, context) => toResult(context, location ? location.relativePath || '/' : ''),
        },
        promptForTypedLocation: async context => toResult(context, await promptForYamlSafeLocation(ctx, {
            key: 'output_location',
            value: (await derive(context)).initialValue,
            prompt: ctx.code.l10n.t(
                'Enter the build output relative to the app location, or leave it blank if there is no build. Learn more: {0}',
                staticWebAppsOutputLocationUrl,
            ),
            validate: input => input === angularOutputPlaceholder
                ? ctx.code.l10n.t('The Angular project name must be resolved before deployment.')
                : undefined,
        })),
    };
}

/** Prompts for build output and gates unsupported direct azd deployment shapes. */
@injectable()
export class OutputLocationStep extends PickWorkspaceLocationStep<CreateStaticWebAppContext> {
    private readonly promptForTypedLocation: OutputLocationParts['promptForTypedLocation'];

    public constructor(
        @inject(IActionContext) actionContext: IActionContext,
        @inject(ICodeContext) ctx: ICodeContext,
    ) {
        const parts = createOutputLocationParts(ctx, actionContext);
        super(ctx, parts.options);
        this.promptForTypedLocation = parts.promptForTypedLocation;
    }

    public override shouldPrompt(context: Readonly<CreateStaticWebAppContext>): boolean {
        return !context.hasInfra && context.outputLocation === undefined;
    }

    /**
     * @inheritdoc
     * @remarks
     * An app folder outside the workspace leaves the picker nothing valid to
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

/**
 * Resolves the build output to prefill, preferring what the project's own build configuration
 * states over the preset's convention, and resolving the Angular placeholder so it is never
 * emitted into Bicep or YAML.
 */
export function resolveDefaultOutputLocation(context: Readonly<CreateStaticWebAppContext>): string {
    if (context.detectedOutputLocation) {
        return context.detectedOutputLocation;
    }

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
