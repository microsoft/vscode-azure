/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep, ICodeContext } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { parseDocument } from 'yaml';
import { IAzdService } from '../../../azd/AzdService';
import { canAzdDeployStaticWebApp } from '../../../staticWebApps/SwaCliConfig';
import type { CreateStaticWebAppContext } from '../CreateStaticWebAppContext';

/**
 * Adds an azd-supported Static Web Apps service without replacing user YAML.
 *
 * azd itself cannot scaffold this entry -- `azd add` offers only
 * `host.appservice` and `host.containerapp`, and `StaticWebAppTarget` exists
 * only on azd's deploy side -- so the wizard writes it or `azd deploy` has
 * nothing to target. See Azure/azure-dev#9718.
 *
 * Restricted to the `deploy` job. A `createNew` run provisions from a
 * {@linkcode TempDirManager} directory that is deleted afterwards, and its
 * `azure.yaml` is never deployed from ({@linkcode AzdDeployStep} requires
 * {@linkcode AzdWizardContext.deploy deploy}), so a `services:` entry there
 * would have no reader.
 */
@injectable()
export class ConfigureStaticWebAppAzureYamlStep extends ExecuteStep<CreateStaticWebAppContext> {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IAzdService) private readonly azd: IAzdService,
    ) {
        super();
    }

    public override async shouldExecute(context: Readonly<CreateStaticWebAppContext>): Promise<boolean> {
        return context.job === 'deploy'
            && !context.hasServices
            && !!context.iacFolder
            && !!context.azdServiceName
            && context.appLocation !== undefined
            && context.outputLocation !== undefined
            && canAzdDeployStaticWebApp(context.outputLocation)
            && (await this.azd.findAzureYaml(context.iacFolder)).length > 0;
    }

    public async execute(context: Readonly<CreateStaticWebAppContext>): Promise<void> {
        const { iacFolder, appLocation, outputLocation, azdServiceName } = context;
        if (!iacFolder || appLocation === undefined || outputLocation === undefined || !azdServiceName) {
            return;
        }
        const yamlUri = (await this.azd.findAzureYaml(iacFolder))[0];
        const source = new TextDecoder().decode(await this.ctx.code.workspace.fs.readFile(yamlUri));
        const document = parseDocument(source);
        if (document.errors.length > 0) {
            throw new Error(this.ctx.code.l10n.t('Unable to update azure.yaml because it is not valid YAML.'));
        }

        const service: Record<string, string> = {
            host: 'staticwebapp',
            project: normalizeProject(appLocation),
            dist: outputLocation,
        };
        if (context.detectedLanguage) {
            service.language = context.detectedLanguage;
        }
        document.setIn(['services', azdServiceName], service);
        await this.ctx.code.workspace.fs.writeFile(yamlUri, new TextEncoder().encode(document.toString()));
    }
}

function normalizeProject(location: string): string {
    const normalized = location.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    return normalized || '.';
}
