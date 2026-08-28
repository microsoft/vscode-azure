/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, ICodeContext, PromptStep, pickWorkspaceLocation } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import type { CreateStaticWebAppContext } from '../CreateStaticWebAppContext';
import { getStaticWebAppCliLocation } from '../../../staticWebApps/SwaCliConfig';
import { staticWebAppsOutputLocationUrl } from '../staticWebAppLinks';
import {
    addLocationTelemetry,
    canAzdDeployStaticWebApp,
    isYamlSafeLocation,
    promptForYamlSafeLocation,
} from './locationUtils';

const angularOutputPlaceholder = 'dist/<project-name>';
const excludedDependencyDirectories = '**/{.git,.hg,.svn,node_modules,bower_components,vendor,.venv,venv,__pycache__,.tox,.gradle,.terraform}/**';

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

    /** @inheritdoc */
    public async prompt(context: Readonly<CreateStaticWebAppContext>): Promise<Partial<CreateStaticWebAppContext>> {
        const defaultValue = resolveDefaultOutputLocation(context);
        const declared = await getStaticWebAppCliLocation(this.ctx.code, 'outputLocation', context.iacFolder);
        const initialValue = declared || defaultValue;

        const outputLocation = await this.pickLocation(context, initialValue);
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

    /**
     * Offers the folders under the app that the workspace can express, and falls back to a typed
     * path when the app folder lies outside the workspace, since the picker could then only
     * produce candidates the workspace cannot name.
     */
    private async pickLocation(context: Readonly<CreateStaticWebAppContext>, value: string): Promise<string> {
        const appRoot = this.resolveAppRoot(context);
        if (!appRoot) {
            return await promptForYamlSafeLocation(this.ctx, {
                key: 'output_location',
                value,
                prompt: this.ctx.code.l10n.t(
                    'Enter the build output relative to the app location, or leave it blank if there is no build. Learn more: {0}',
                    staticWebAppsOutputLocationUrl,
                ),
                validate: input => input === angularOutputPlaceholder
                    ? this.ctx.code.l10n.t('The Angular project name must be resolved before deployment.')
                    : undefined,
            });
        }

        const location = await pickWorkspaceLocation(this.ctx, {
            kind: 'folder',
            strings: {
                title: this.ctx.code.l10n.t('Select the build output location'),
                placeHolder: this.ctx.code.l10n.t('Choose a folder, enter a location relative to the app, or select no build output'),
            },
            findFiles: [
                { base: appRoot.fsPath, baseUri: appRoot, pattern: '**/*' },
                { base: appRoot.fsPath, baseUri: appRoot, pattern: excludedDependencyDirectories },
                1000,
            ],
            relativeTo: appRoot,
            value,
            suggestedRelativePaths: [
                value,
                context.detectedOutputLocation,
                context.buildPreset?.outputLocation,
            ].filter((item): item is string => !!item && item !== angularOutputPlaceholder),
            allowCustom: true,
            noneLabel: this.ctx.code.l10n.t('$(circle-slash) No build output'),
            isValidRelativePath: input => input !== angularOutputPlaceholder
                && isYamlSafeLocation(input, 'output_location'),
        });

        return location ? location.relativePath || '/' : '';
    }

    /**
     * Resolves the folder build output is named relative to, which is the app rather than the
     * workspace root.
     *
     * @returns `undefined` when that folder is unknown or outside the workspace.
     */
    private resolveAppRoot(context: Readonly<CreateStaticWebAppContext>): vscode.Uri | undefined {
        const iacFolder = context.iacFolder;
        if (!iacFolder) {
            return undefined;
        }

        const appLocation = context.appLocation ?? context.detectedAppLocation ?? context.buildPreset?.appLocation ?? '/';
        const normalized = appLocation.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        const appRoot = normalized ? this.ctx.code.Uri.joinPath(iacFolder, normalized) : iacFolder;
        return this.ctx.code.workspace.getWorkspaceFolder(appRoot) ? appRoot : undefined;
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
