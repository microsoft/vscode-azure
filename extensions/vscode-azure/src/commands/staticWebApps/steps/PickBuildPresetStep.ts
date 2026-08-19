/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, ICodeContext, PromptStep, showSmartQuickPick } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import type { CreateStaticWebAppContext } from '../CreateStaticWebAppContext';
import { staticWebAppBuildPresets, type StaticWebAppBuildPreset } from '../buildPresets';
import { staticWebAppsBuildPresetsUrl } from '../staticWebAppLinks';
import { detectStaticWebAppProject } from './frameworkDetection';

interface BuildPresetPick extends vscode.QuickPickItem {
    readonly data?: StaticWebAppBuildPreset;
    readonly custom?: boolean;
}

/** Selects grouped build metadata after detecting reusable workspace signals. */
@injectable()
export class PickBuildPresetStep extends PromptStep<CreateStaticWebAppContext> {
    public constructor(
        @inject(IActionContext) private readonly actionContext: IActionContext,
        @inject(ICodeContext) private readonly ctx: ICodeContext,
    ) {
        super();
    }

    public override shouldPrompt(context: Readonly<CreateStaticWebAppContext>): boolean {
        return !context.hasInfra && !context.buildPresetSelection;
    }

    public async prompt(context: Readonly<CreateStaticWebAppContext>): Promise<Partial<CreateStaticWebAppContext>> {
        const detection = context.iacFolder
            ? await detectStaticWebAppProject(this.ctx.code, context.iacFolder)
            : { frameworks: [], apiLocations: [] };
        const items: BuildPresetPick[] = [
            { label: this.ctx.code.l10n.t('Framework'), kind: this.ctx.code.QuickPickItemKind.Separator },
            ...staticWebAppBuildPresets.filter(preset => preset.group === 'framework').map(data => ({ label: data.displayName, data })),
            { label: this.ctx.code.l10n.t('Static site generator'), kind: this.ctx.code.QuickPickItemKind.Separator },
            ...staticWebAppBuildPresets.filter(preset => preset.group === 'ssg').map(data => ({ label: data.displayName, data })),
            { label: this.ctx.code.l10n.t('Other'), kind: this.ctx.code.QuickPickItemKind.Separator },
            { label: this.ctx.code.l10n.t('$(keyboard) Custom'), custom: true },
        ];
        const selected = await showSmartQuickPick(this.ctx, items, {
            title: this.ctx.code.l10n.t('Static Web Apps build presets - Learn more: {0}', staticWebAppsBuildPresetsUrl),
            placeHolder: this.ctx.code.l10n.t('Choose a build preset to configure the default project structure'),
            isActiveItem: item => !!detection.primaryPresetId && item.data?.id === detection.primaryPresetId,
            showBack: true,
        });
        this.actionContext.telemetry.properties.buildPreset = selected.data?.displayName ?? 'Custom';
        this.actionContext.telemetry.properties.detectedFrameworks = detection.frameworks.length > 0
            ? detection.frameworks.join(',')
            : 'N/A';
        this.actionContext.telemetry.properties.detectedApis = String(detection.apiLocations.length);

        return {
            buildPreset: selected.data,
            buildPresetSelection: selected.data?.id ?? 'custom',
            detectedFrameworks: detection.frameworks,
            detectedApiLocations: detection.apiLocations,
            detectedAppLocation: detection.appLocation,
            angularProjectName: detection.angularProjectName,
            detectedLanguage: detection.language,
        };
    }
}
