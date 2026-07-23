/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep, ICodeContext } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { parseDocument } from 'yaml';
import { IAzdService } from '../../../azd/AzdService';
import type { CreateStaticWebAppContext } from '../CreateStaticWebAppContext';
import { canAzdDeployStaticWebApp } from './locationUtils';

/** Adds an azd-supported Static Web Apps service without replacing user YAML. */
@injectable()
export class ConfigureStaticWebAppAzureYamlStep extends ExecuteStep<CreateStaticWebAppContext> {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IAzdService) private readonly azd: IAzdService,
    ) {
        super();
    }

    public override async shouldExecute(context: Readonly<CreateStaticWebAppContext>): Promise<boolean> {
        return !context.hasServices
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
