/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, ICodeContext, PromptStep, showSmartInputBox, showSmartQuickPick, type QuickPickItemWithData } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type { CreateStaticWebAppContext } from '../CreateStaticWebAppContext';
import { getStaticWebAppCliLocation } from '../../../staticWebApps/SwaCliConfig';
import { staticWebAppsApiLocationUrl } from '../staticWebAppLinks';
import { addLocationTelemetry, isYamlSafeLocation } from './locationUtils';

interface ApiLocationChoice {
    readonly location?: string;
    readonly custom?: true;
}

/** Resolves detected Functions APIs before falling back to an editable path. */
@injectable()
export class ApiLocationStep extends PromptStep<CreateStaticWebAppContext> {
    public constructor(
        @inject(IActionContext) private readonly actionContext: IActionContext,
        @inject(ICodeContext) private readonly ctx: ICodeContext,
    ) {
        super();
    }

    public override shouldPrompt(context: Readonly<CreateStaticWebAppContext>): boolean {
        return !context.hasInfra && context.apiLocation === undefined;
    }

    public async prompt(context: Readonly<CreateStaticWebAppContext>): Promise<Partial<CreateStaticWebAppContext>> {
        const defaultValue = context.buildPreset?.apiLocation ?? 'api';
        const declared = await getStaticWebAppCliLocation(this.ctx.code, 'apiLocation', context.iacFolder);
        const detected = context.detectedApiLocations ?? [];
        let apiLocation: string;

        if (detected.length === 1) {
            apiLocation = detected[0];
        } else if (detected.length === 0) {
            apiLocation = declared ?? this.locationWithoutFunctions(context);
        } else {
            const items: QuickPickItemWithData<ApiLocationChoice>[] = [
                ...detected.map(location => ({
                    label: location === '/' ? this.ctx.code.l10n.t('(workspace root)') : location,
                    data: { location },
                })),
                { label: this.ctx.code.l10n.t('$(keyboard) Enter a different location'), data: { custom: true } },
                { label: this.ctx.code.l10n.t('$(circle-slash) No API'), data: { location: '' } },
            ];
            const selected = await showSmartQuickPick(this.ctx, items, {
                placeHolder: this.ctx.code.l10n.t('Select the location of your Azure Functions code'),
                showBack: true,
            });
            apiLocation = selected.data.custom
                ? await this.promptForLocation(declared || defaultValue)
                : selected.data.location ?? '';
        }

        apiLocation = apiLocation.trim();
        addLocationTelemetry(this.actionContext, 'apiLocation', apiLocation, defaultValue, declared);
        return { apiLocation };
    }

    /**
     * Resolves the API location for a project with no Azure Functions app in it.
     *
     * A preset whose build emits the API keeps its path, since the folder only appears once the
     * framework compiles its server. Every other preset names a convention rather than something
     * the project has, so an empty value keeps the generated infrastructure honest instead of
     * pointing it at a folder that will never exist.
     */
    private locationWithoutFunctions(context: Readonly<CreateStaticWebAppContext>): string {
        return context.buildPreset?.buildEmitsApi ? context.buildPreset.apiLocation : '';
    }

    private promptForLocation(value: string): Promise<string> {
        return showSmartInputBox(this.ctx, {
            value,
            prompt: this.ctx.code.l10n.t(
                'Enter the Azure Functions code location, or leave it blank for no API. Learn more: {0}',
                staticWebAppsApiLocationUrl,
            ),
            showBack: true,
            validateInput: input => isYamlSafeLocation(input, 'api_location')
                ? undefined
                : this.ctx.code.l10n.t('Enter a value that is safe to use in YAML.'),
        });
    }
}
