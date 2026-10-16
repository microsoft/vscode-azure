/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppServiceLogicalType, AzureNodeId, FunctionAppLogicalType, LogicAppLogicalType } from '@microsoft/vscode-azure-azutils';
import { createMockWebAppClient } from '@microsoft/vscode-azure-azutils/testing';
import { createMockVsCode, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { WebAppSettingsAdapter } from '../../../../src/settings/adapters/WebAppSettingsAdapter';
import { isSettingsNode } from '../../../../src/tree/resources/settings/SettingsNode';
import { WebAppDataProvider } from '../../../../src/tree/resources/webApp/WebAppDataProvider';
import type { WebApp } from '../../../../src/tree/resources/webApp/WebApp';
import { getWebsiteUrl } from '../../../../src/tree/resources/websiteUrl';
import { makeSettingsResource } from '../../../settings/mockSettings';

describe('WebAppDataProvider (unit)', () => {
    const client = createMockWebAppClient({ defaultHostName: 'myfuncapp.azurewebsites.net' });
    const { executor } = createTestActionExecutor();
    const adapter = new WebAppSettingsAdapter(
        createMockVsCode().vscode,
        () => client,
    );
    const provider = new WebAppDataProvider(executor, () => client, adapter);

    it('claims resources supported by its settings adapter', () => {
        expect(provider.canHandle(makeSettingsResource())).to.be.true;
        expect(provider.canHandle(makeSettingsResource({
            logicalType: 'Microsoft.Storage/storageAccounts',
        }))).to.be.false;
    });

    it('contributes a settings node carrying its adapter', () => {
        const [node] = provider.getChildren(makeSettingsResource());

        expect(isSettingsNode(node)).to.be.true;
        if (!isSettingsNode(node)) {
            throw new Error('Expected a settings node');
        }

        expect(node.azureResource.logicalType).to.equal(FunctionAppLogicalType);
        expect(node).to.have.property('adapter', adapter);
    });

    it('enriches resources with their website URL', async () => {
        const resource = makeSettingsResource();

        await provider.enrich(resource);

        expect(getWebsiteUrl(resource)).to.equal('https://myfuncapp.azurewebsites.net');
        expect(client.webApps.get.mock.calls[0].arguments).to.deep.equal(['MyRG', 'MyFuncApp']);
    });

    for (const logicalType of [AppServiceLogicalType, FunctionAppLogicalType, LogicAppLogicalType]) {
        it(`enriches the same ${logicalType} resource with site metadata and its website capability`, async () => {
            const siteClient = createMockWebAppClient({ defaultHostName: 'myapp.azurewebsites.net', site: { state: 'Stopped' } });
            const data = new WebAppDataProvider(executor, () => siteClient, adapter);
            const app: WebApp = makeSettingsResource({ logicalType });
            const key = AzureNodeId.from(app).toString();

            await data.enrich(app);

            expect(app.site).to.include({ state: 'Stopped' });
            expect(getWebsiteUrl(app)).to.equal('https://myapp.azurewebsites.net');
            expect(AzureNodeId.from(app).toString()).to.equal(key);
            expect(siteClient.webApps.get.mock.calls[0].arguments).to.deep.equal(['MyRG', app.name]);

            siteClient.webApps.get.mock.mockImplementation(() => Promise.reject(new Error('Access denied')));
            await expect(data.enrich(app)).to.be.rejectedWith('Access denied');
            expect(app.site).to.be.undefined;
        });
    }
});
