/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SiteType, StaticWebAppType, type IWebAppClient } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { mock } from 'node:test';
import { MicrosoftWebEndpointProvider } from '../../src/endpoints/MicrosoftWebEndpointProvider';

describe('MicrosoftWebEndpointProvider (unit)', () => {
    function createProvider() {
        const getWebApp = mock.fn(() => Promise.resolve({
            location: 'eastus',
            defaultHostName: 'app.azurewebsites.net',
        }));
        const getStaticSite = mock.fn(() => Promise.resolve({
            location: 'eastus',
            defaultHostname: 'site.azurestaticapps.net',
        }));
        const client: IWebAppClient = {
            webApps: {
                get: getWebApp,
                listApplicationSettings: mock.fn(() => Promise.resolve({})),
                updateApplicationSettings: mock.fn(() => Promise.resolve({})),
            },
            staticSites: {
                getStaticSite,
            },
        };
        const { vscode } = createMockVsCode();
        return { provider: new MicrosoftWebEndpointProvider(vscode, () => client), getWebApp, getStaticSite };
    }

    it('should handle Microsoft.Web sites and Static Web Apps case-insensitively', () => {
        const { provider } = createProvider();

        expect(provider.canHandle(makeGenericResource({ type: SiteType.toUpperCase() }))).to.be.true;
        expect(provider.canHandle(makeGenericResource({ type: StaticWebAppType.toUpperCase() }))).to.be.true;
        expect(provider.canHandle(makeGenericResource({ type: 'Microsoft.Storage/storageAccounts' }))).to.be.false;
    });

    it('should resolve an App Service hostname from ARM', async () => {
        const { provider, getWebApp } = createProvider();
        const resource = makeGenericResource({
            id: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Web/sites/app',
            name: 'app',
            type: SiteType,
        });

        const endpoint = await provider.getEndpoint(resource);

        expect(endpoint).to.equal('app.azurewebsites.net');
        expect(getWebApp.mock.calls[0].arguments).to.deep.equal(['rg', 'app']);
    });

    it('should resolve a Static Web App hostname from ARM', async () => {
        const { provider, getStaticSite } = createProvider();
        const resource = makeGenericResource({
            id: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Web/staticSites/site',
            name: 'site',
            type: StaticWebAppType,
        });

        const endpoint = await provider.getEndpoint(resource);

        expect(endpoint).to.equal('site.azurestaticapps.net');
        expect(getStaticSite.mock.calls[0].arguments).to.deep.equal(['rg', 'site']);
    });
});
