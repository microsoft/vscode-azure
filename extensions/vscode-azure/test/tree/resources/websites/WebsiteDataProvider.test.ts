/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppServiceLogicalType, StaticWebAppType } from '@microsoft/vscode-azure-azutils';
import { createMockWebAppClient, makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import { createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { getWebsiteUrl } from '../../../../src/tree/resources/websiteUrl';
import { WebsiteDataProvider } from '../../../../src/tree/resources/websites/WebsiteDataProvider';

function makeWebApp() {
    return makeGenericResource({ logicalType: AppServiceLogicalType });
}

function makeStaticWebApp() {
    return makeGenericResource({
        id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Web/staticSites/swa1',
        name: 'swa1',
        type: StaticWebAppType,
        logicalType: StaticWebAppType,
    });
}

describe('WebsiteDataProvider (unit)', () => {
    function createProvider(client = createMockWebAppClient()) {
        const { executor } = createTestActionExecutor();
        return { provider: new WebsiteDataProvider(executor, () => client), client };
    }

    describe('canHandle', () => {
        it('should handle app service web apps and static web apps', () => {
            const { provider } = createProvider();

            expect(provider.canHandle(makeWebApp())).to.be.true;
            expect(provider.canHandle(makeStaticWebApp())).to.be.true;
        });

        it('should not handle function apps or unrelated resources', () => {
            const { provider } = createProvider();

            // Function apps carry their own logical type and are owned by FunctionAppDataProvider.
            expect(provider.canHandle(makeGenericResource({ logicalType: 'Microsoft.Web/sites~functionapp' }))).to.be.false;
            expect(provider.canHandle(makeGenericResource({ type: 'Microsoft.Storage/storageAccounts', logicalType: 'Microsoft.Storage/storageAccounts' }))).to.be.false;
            expect(provider.canHandle(undefined)).to.be.false;
        });
    });

    describe('enrich', () => {
        it('should attach the web app default hostname', async () => {
            const { provider, client } = createProvider(createMockWebAppClient({ defaultHostName: 'contoso.azurewebsites.net' }));
            const resource = makeWebApp();

            await provider.enrich(resource);

            expect(getWebsiteUrl(resource)).to.equal('https://contoso.azurewebsites.net/');
            expect(client.webApps.get.mock.calls[0].arguments).to.deep.equal(['rg1', 'site1']);
        });

        it('should attach the static web app default hostname', async () => {
            const { provider, client } = createProvider(createMockWebAppClient({ staticSiteHostname: 'happy-sky.azurestaticapps.net' }));
            const resource = makeStaticWebApp();

            await provider.enrich(resource);

            expect(getWebsiteUrl(resource)).to.equal('https://happy-sky.azurestaticapps.net/');
            expect(client.staticSites.getStaticSite.mock.calls[0].arguments).to.deep.equal(['rg1', 'swa1']);
        });

        it('should attach nothing when the resource reports no hostname', async () => {
            const { provider } = createProvider();
            const resource = makeWebApp();

            await provider.enrich(resource);

            expect(getWebsiteUrl(resource)).to.be.undefined;
        });

        it('should ignore resources it does not own', async () => {
            const { provider, client } = createProvider();

            await provider.enrich(makeGenericResource());

            expect(client.webApps.get.mock.callCount()).to.equal(0);
        });
    });
});
