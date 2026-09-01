/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId } from '@microsoft/vscode-azure-azutils';
import { createMockViewItemTree, makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import { createMockCodeContext, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { OpenUrl } from '../../../src/commands/OpenUrl';
import { BrowseWebsite } from '../../../src/commands/tree/BrowseWebsite';
import type { IAzureViewViewItemTree } from '../../../src/services';
import { setWebsiteUrl } from '../../../src/tree/resources/websiteUrl';
import { createTestResourceSelector } from '../../tree/resources/testResourceSelector';

describe('BrowseWebsite (unit)', () => {
    function createCommand(hostname?: string) {
        const codeContext = createMockCodeContext();
        const resource = makeGenericResource();
        setWebsiteUrl(resource, hostname);
        const key = AzureNodeId.from(resource).toString();
        const viewTree = createMockViewItemTree({ '': [key] }) as unknown as IAzureViewViewItemTree;
        const { selector } = createTestResourceSelector({ nodes: [resource], codeContext, viewTree });
        const command = new BrowseWebsite(codeContext.ctx.code, selector, new OpenUrl(codeContext.ctx.code));
        return { command, mockResult: codeContext.mock, openExternal: codeContext.mock.env.openExternal, key, resource };
    }

    it('should open the website url attached by enrichment', async () => {
        const { command, openExternal, key } = createCommand('contoso.azurewebsites.net');

        await command.execute(key);

        expect(openExternal.mock.callCount()).to.equal(1);
        // The stored value has no trailing slash; Uri.toString() normalizes one in.
        expect(String(openExternal.mock.calls[0].arguments[0])).to.equal('https://contoso.azurewebsites.net/');
    });

    it('should prompt for a resource when invoked from the command palette', async () => {
        const { command, mockResult, openExternal, resource } = createCommand('contoso.azurewebsites.net');
        respondToPrompts(mockResult, [{ pick: resource.name }]);

        await command.execute();

        expect(openExternal.mock.callCount()).to.equal(1);
    });

    it('should report when the selected resource has no website', async () => {
        const { command, openExternal, key } = createCommand();

        await expect(command.execute(key)).to.be.rejectedWith('The selected resource does not have a website.');
        expect(openExternal.mock.callCount()).to.equal(0);
    });

    it('should reject an invalid tree selection', async () => {
        const { command, openExternal } = createCommand('contoso.azurewebsites.net');

        await expect(command.execute('missing')).to.be.rejectedWith('Select an Azure resource with a website.');
        expect(openExternal.mock.callCount()).to.equal(0);
    });
});
