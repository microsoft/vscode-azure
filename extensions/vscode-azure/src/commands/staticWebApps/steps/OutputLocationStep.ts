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
import { staticWebAppsOutputLocationUrl } from '../staticWebAppLinks';
import { addLocationTelemetry, canAzdDeployStaticWebApp, isYamlSafeLocation } from './locationUtils';

const angularOutputPlaceholder = 'dist/<project-name>';
const excludedDependencyDirectories = '**/{.git,.hg,.svn,node_modules,bower_components,vendor,.venv,venv,__pycache__,.tox,.gradle,.terraform}/**';

interface OutputLocationPickContext {
    readonly location?: WorkspaceLocation;
}

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
        const initialValue = declared || defaultValue;
        const appRoot = this.resolveAppRoot(context);
        const outputLocation = appRoot && this.ctx.code.workspace.getWorkspaceFolder(appRoot)
            ? await this.pickLocation(appRoot, initialValue, [
                initialValue,
                context.detectedOutputLocation,
                context.buildPreset?.outputLocation,
            ])
            : await this.promptForLocation(initialValue);
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

    private resolveAppRoot(context: Readonly<CreateStaticWebAppContext>): WorkspaceLocation['uri'] | undefined {
        if (!context.iacFolder) {
            return undefined;
        }
        const appLocation = context.appLocation ?? context.detectedAppLocation ?? context.buildPreset?.appLocation ?? '/';
        const normalized = appLocation.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        return normalized ? this.ctx.code.Uri.joinPath(context.iacFolder, normalized) : context.iacFolder;
    }

    private async pickLocation(
        appRoot: WorkspaceLocation['uri'],
        value: string,
        suggestions: readonly (string | undefined)[],
    ): Promise<string> {
        const step = new PickWorkspaceLocationStep<OutputLocationPickContext>(
            this.ctx,
            [
                { base: appRoot.fsPath, baseUri: appRoot, pattern: '**/*' },
                { base: appRoot.fsPath, baseUri: appRoot, pattern: excludedDependencyDirectories },
                1000,
            ],
            {
                kind: 'folder',
                contextProperty: 'location',
                relativeTo: appRoot,
                suggestedRelativePaths: suggestions.filter(
                    (item): item is string => !!item && item !== angularOutputPlaceholder,
                ),
                value,
                allowCustom: true,
                noneLabel: this.ctx.code.l10n.t('$(circle-slash) No build output'),
                isValidRelativePath: input => input !== angularOutputPlaceholder
                    && isYamlSafeLocation(input, 'output_location'),
                strings: {
                    title: this.ctx.code.l10n.t('Select the build output location'),
                    placeHolder: this.ctx.code.l10n.t('Choose a folder, enter a location relative to the app, or select no build output'),
                },
            },
        );
        const result = await step.prompt({});
        return result.location ? result.location.relativePath || '/' : '';
    }

    private async promptForLocation(value: string): Promise<string> {
        return (await showSmartInputBox(this.ctx, {
            value,
            prompt: this.ctx.code.l10n.t(
                'Enter the build output relative to the app location, or leave it blank if there is no build. Learn more: {0}',
                staticWebAppsOutputLocationUrl,
            ),
            showBack: true,
            validateInput: input => {
                if (input === angularOutputPlaceholder) {
                    return this.ctx.code.l10n.t('The Angular project name must be resolved before deployment.');
                }
                return isYamlSafeLocation(input, 'output_location')
                    ? undefined
                    : this.ctx.code.l10n.t('Enter a value that is safe to use in YAML.');
            },
        })).trim();
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
