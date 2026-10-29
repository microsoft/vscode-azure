/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecuteStep, IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IAzdService } from '../../../azd/AzdService';
import { canAzdDeployStaticWebApp } from '../../../staticWebApps/SwaCliConfig';
import { requireWorkspaceTrust } from '../../../utils/workspaceTrust';
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
        @inject(IAzdService) private readonly azd: IAzdService,
        @inject(IVsCode) private readonly code: IVsCode,
    ) {
        super();
    }

    public override async shouldExecute(context: Readonly<CreateStaticWebAppContext>): Promise<boolean> {
        const iacFolder = context.iacFolder;
        const applicable = context.job === 'deploy'
            && !context.hasServices
            && !!iacFolder
            && !!context.azdServiceName
            && context.appLocation !== undefined
            && context.outputLocation !== undefined
            && canAzdDeployStaticWebApp(context.outputLocation);
        if (!applicable) {
            return false;
        }

        // Looking for azure.yaml scans the project, so refuse before the scan.
        requireWorkspaceTrust(this.code);
        return (await this.azd.findAzureYaml(iacFolder)).length > 0;
    }

    public async execute(context: Readonly<CreateStaticWebAppContext>): Promise<void> {
        requireWorkspaceTrust(this.code);

        const { iacFolder, appLocation, outputLocation, azdServiceName } = context;
        if (!iacFolder || appLocation === undefined || outputLocation === undefined || !azdServiceName) {
            return;
        }

        const service: Record<string, string> = {
            host: 'staticwebapp',
            project: context.swaCliConfig ? '.' : normalizeProject(appLocation),
        };
        if (!context.swaCliConfig) {
            service.dist = outputLocation;
        }
        if (context.detectedLanguage) {
            service.language = context.detectedLanguage;
        }

        // Writing this entry means editing azure.yaml, and this is the sanctioned way to do
        // that until azd grows first-class support (Azure/azure-dev#9718).
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        await this.azd.updateAzureYaml(iacFolder, editor => { editor.set(['services', azdServiceName], service); });
    }
}

function normalizeProject(location: string): string {
    const normalized = location.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    return normalized || '.';
}
