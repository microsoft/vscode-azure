/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getResourceGroupName, IWebAppClientProvider, SiteType, StaticWebAppType, type GenericResource } from '@microsoft/vscode-azure-azutils';
import { inject, injectable } from 'inversify';
import type { ResourceEndpointProvider } from './ResourceEndpointResolver';

/** Resolves endpoints for App Service-family resources and Static Web Apps. */
@injectable()
export class MicrosoftWebEndpointProvider implements ResourceEndpointProvider {
    public constructor(
        @inject(IWebAppClientProvider) private readonly createClient: IWebAppClientProvider,
    ) { }

    /** @inheritdoc */
    public canHandle(resource: GenericResource): boolean {
        return isType(resource, SiteType) || isType(resource, StaticWebAppType);
    }

    /** @inheritdoc */
    public async getEndpoint(resource: GenericResource): Promise<string | undefined> {
        const client = this.createClient(resource.subscription);
        const resourceGroupName = getResourceGroupName(resource.id);

        if (isType(resource, StaticWebAppType)) {
            return (await client.staticSites.getStaticSite(resourceGroupName, resource.name)).defaultHostname;
        }

        return (await client.webApps.get(resourceGroupName, resource.name)).defaultHostName;
    }
}

function isType(resource: GenericResource, armType: string): boolean {
    return resource.type.toLowerCase() === armType.toLowerCase();
}
