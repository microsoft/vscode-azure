/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SiteType, StaticWebAppType } from '@microsoft/vscode-azure-azutils';
import { createMockWebAppClient, makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import { expect } from 'chai';
import { MicrosoftWebEndpointProvider } from '../../src/endpoints/MicrosoftWebEndpointProvider';

describe('MicrosoftWebEndpointProvider (unit)', () => {
    function createProvider() {
        const client = createMockWebAppClient({
            defaultHostName: 'app.azurewebsites.net',
            staticSiteHostname: 'site.azurestaticapps.net',
        });
        return { provider: new MicrosoftWebEndpointProvider(() => client), client };
    }

    it('should handle Microsoft.Web sites and Static Web Apps case-insensitively', () => {
        const { provider } = createProvider();

        expect(provider.canHandle(makeGenericResource({ type: SiteType.toUpperCase() }))).to.be.true;
        expect(provider.canHandle(makeGenericResource({ type: StaticWebAppType.toUpperCase() }))).to.be.true;
        expect(provider.canHandle(makeGenericResource({ type: 'Microsoft.Storage/storageAccounts' }))).to.be.false;
    });

    it('should resolve an App Service hostname from ARM', async () => {
        const { provider, client } = createProvider();
        const resource = makeGenericResource({
            id: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Web/sites/app',
            name: 'app',
            type: SiteType,
        });

        const endpoint = await provider.getEndpoint(resource);

        expect(endpoint).to.equal('app.azurewebsites.net');
        expect(client.webApps.get.mock.calls[0].arguments).to.deep.equal(['rg', 'app']);
    });

    it('should resolve a Static Web App hostname from ARM', async () => {
        const { provider, client } = createProvider();
        const resource = makeGenericResource({
            id: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Web/staticSites/site',
            name: 'site',
            type: StaticWebAppType,
        });

        const endpoint = await provider.getEndpoint(resource);

        expect(endpoint).to.equal('site.azurestaticapps.net');
        expect(client.staticSites.getStaticSite.mock.calls[0].arguments).to.deep.equal(['rg', 'site']);
    });
});
