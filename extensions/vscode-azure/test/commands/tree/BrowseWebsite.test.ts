/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId } from '@microsoft/vscode-azure-azutils';
import { createMockDataItemTree, makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { BrowseWebsite } from '../../../src/commands/tree/BrowseWebsite';
import { setWebsiteUrl } from '../../../src/tree/resources/websiteUrl';

describe('BrowseWebsite (unit)', () => {
    function createProvider(endpoint?: string) {
        const mockResult = createMockVsCode();
        const resource = makeGenericResource();
        setWebsiteUrl(resource, endpoint);
        const dataTree = createMockDataItemTree([resource]);
        const provider = new BrowseWebsite(mockResult.vscode, dataTree);
        return { provider, key: AzureNodeId.from(resource).toString() };
    }

    it('should return the website url attached by enrichment', async () => {
        const { provider, key } = createProvider('contoso.azurewebsites.net');

        expect(await provider.getUrl(key)).to.equal('https://contoso.azurewebsites.net/');
    });

    it('should report when the selected resource has no website', async () => {
        const { provider, key } = createProvider();

        await expect(provider.getUrl(key)).to.be.rejectedWith('The selected resource does not have a website.');
    });

    it('should reject an invalid tree selection', async () => {
        const { provider } = createProvider('https://example.com/');

        await expect(provider.getUrl('missing')).to.be.rejectedWith('Select an Azure resource with a website.');
    });
});
