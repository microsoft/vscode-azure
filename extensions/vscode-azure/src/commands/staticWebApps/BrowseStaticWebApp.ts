/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import {
    isStaticWebAppVirtualNode,
    StaticWebAppVirtualTypes,
    type StaticWebAppEnvironment,
} from '../../tree/resources/staticWebApps/StaticWebApp';
import type { ManagedCommand } from '../ManagedCommand';
import { StaticWebAppCommandResolver } from './StaticWebAppCommandResolver';

/** Opens a Static Web App or environment hostname over HTTPS. */
@injectable()
export class BrowseStaticWebApp implements ManagedCommand {
    /** Context value for site and environment tree items. */
    public static readonly ContextValue = 'browseStaticWebApp';

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(StaticWebAppCommandResolver) private readonly resolver: StaticWebAppCommandResolver,
    ) { }

    /** @inheritdoc */
    public async execute(key?: string): Promise<void> {
        let hostname: string | undefined;
        if (key) {
            const resource = this.resolver.dataTree.get(key);
            if (isStaticWebAppVirtualNode(resource) && resource.virtualType === StaticWebAppVirtualTypes.Environment) {
                hostname = resource.hostname;
            }
        }

        const site = await this.resolver.resolveSite(key);
        if (!hostname) {
            hostname = (await this.resolver.whenSiteEnriched(site)).defaultHostname;
        }
        if (!hostname) {
            throw new Error(this.code.l10n.t('The selected Static Web App does not have a hostname.'));
        }

        const httpsUrl = `https://${hostname.replace(/^https?:\/\//i, '')}`;
        await this.code.env.openExternal(this.code.Uri.parse(httpsUrl));
    }
}

/** Narrows a Static Web Apps virtual node to an environment. */
export function isStaticWebAppEnvironment(resource: Parameters<typeof isStaticWebAppVirtualNode>[0]): resource is StaticWebAppEnvironment {
    return isStaticWebAppVirtualNode(resource) && resource.virtualType === StaticWebAppVirtualTypes.Environment;
}
