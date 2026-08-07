/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWebAppClientProvider, parseAzureResourceId, SiteType, StaticWebAppType, type GenericResource, type IWebAppClient } from '@microsoft/vscode-azure-azutils';
import { IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type { ResourceEndpointProvider } from './ResourceEndpointProvider';

/** Resolves endpoints for App Service-family resources and Static Web Apps. */
@injectable()
export class MicrosoftWebEndpointProvider implements ResourceEndpointProvider {
    private readonly clientCache = new Map<string, IWebAppClient>();

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IWebAppClientProvider) private readonly createClient: IWebAppClientProvider,
    ) { }

    /** @inheritdoc */
    public canHandle(resource: GenericResource): boolean {
        return resource.type.toLowerCase() === SiteType.toLowerCase()
            || resource.type.toLowerCase() === StaticWebAppType.toLowerCase();
    }

    /** @inheritdoc */
    public async getEndpoint(resource: GenericResource): Promise<string | undefined> {
        const { resourceGroup } = parseAzureResourceId(resource.id);
        if (!resourceGroup) {
            throw new Error(this.code.l10n.t('Cannot extract a resource group name from the selected resource ID.'));
        }

        const client = this.getOrCreateClient(resource);
        if (resource.type.toLowerCase() === StaticWebAppType.toLowerCase()) {
            const site = await client.staticSites.getStaticSite(resourceGroup, resource.name);
            return site.defaultHostname;
        }

        const site = await client.webApps.get(resourceGroup, resource.name);
        return site.defaultHostName;
    }

    private getOrCreateClient(resource: GenericResource): IWebAppClient {
        let client = this.clientCache.get(resource.subscription.subscriptionId);
        if (!client) {
            client = this.createClient(resource.subscription);
            this.clientCache.set(resource.subscription.subscriptionId, client);
        }
        return client;
    }
}
